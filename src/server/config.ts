import type { z } from "zod";
import { Prisma, prisma, type User } from "./db";
import { LIMITS } from "../shared/constants";
import type { guidelineSchema, settingsSchema, statusSchema, tagSchema, typeSchema } from "../shared/schemas";
import { slugify } from "../shared/text";
import { audit } from "./audit";
import { encryptSecret } from "./crypto";
import { parseWebhookUrl } from "./discord";
import { badRequest, conflict, forbidden, notFound } from "./errors";

/**
 * Owner-only configuration: site settings, statuses, types, tags, guidelines
 * and the webhook. Each function checks the caller is the owner itself.
 */

type Tx = Prisma.TransactionClient;

function assertOwner(actor: User): void {
  if (!actor.isOwner) throw forbidden();
}

/**
 * A slug nobody else uses: `base`, then `base-2`, `base-3`... Checked up front
 * rather than by retrying on a unique violation, because a failed statement
 * aborts the whole Postgres transaction. Only the owner creates these, so
 * there is no realistic race.
 */
async function freeSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, 40)}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw conflict("slug_taken", "Please choose a different name.");
}

async function reorder(
  actor: User,
  ids: string[],
  existing: () => Promise<{ id: string }[]>,
  write: (tx: Tx, id: string, sortOrder: number) => Promise<unknown>,
): Promise<void> {
  assertOwner(actor);
  const current = (await existing()).map((r) => r.id).sort();
  const given = [...new Set(ids)].sort();
  if (current.length !== given.length || current.some((id, i) => id !== given[i])) {
    throw badRequest("The list changed while you were editing it. Reload and try again.", "stale_order");
  }
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of ids.entries()) await write(tx, id, index);
  });
}

// ── Settings ─────────────────────────────────────────────────────────

export async function updateSettings(actor: User, input: z.infer<typeof settingsSchema>, request?: Request): Promise<void> {
  assertOwner(actor);
  const { introText, discordInviteUrl, ...rest } = input;
  await prisma.settings.update({
    where: { id: 1 },
    data: {
      ...rest,
      ...(introText !== undefined ? { introText: introText || null } : {}),
      ...(discordInviteUrl !== undefined ? { discordInviteUrl: discordInviteUrl || null } : {}),
    },
  });
  await audit({ action: "settings.update", actor, targetType: "settings", details: { changed: input }, request });
}

/** An empty string clears the webhook. The URL is stored encrypted and never sent back to the browser. */
export async function setWebhook(actor: User, url: string, request?: Request): Promise<{ configured: boolean }> {
  assertOwner(actor);
  const trimmed = url.trim();
  if (trimmed === "") {
    await prisma.settings.update({ where: { id: 1 }, data: { webhookUrlEnc: null } });
    await audit({ action: "settings.webhook", actor, targetType: "settings", details: { configured: false }, request });
    return { configured: false };
  }
  const safe = parseWebhookUrl(trimmed);
  if (!safe) throw badRequest("That doesn't look like a Discord webhook URL.", "invalid_webhook");
  await prisma.settings.update({ where: { id: 1 }, data: { webhookUrlEnc: encryptSecret(safe) } });
  await audit({ action: "settings.webhook", actor, targetType: "settings", details: { configured: true }, request });
  return { configured: true };
}

// ── Statuses ─────────────────────────────────────────────────────────

type StatusInput = z.infer<typeof statusSchema>;

export async function createStatus(actor: User, input: StatusInput, request?: Request): Promise<{ id: string }> {
  assertOwner(actor);
  const created = await prisma.$transaction(async (tx) => {
    if ((await tx.status.count()) >= LIMITS.maxStatuses) {
      throw conflict("too_many", `You can have up to ${LIMITS.maxStatuses} statuses.`);
    }
    if (await tx.status.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) {
      throw conflict("duplicate_name", "A status with that name already exists.");
    }
    const sortOrder = ((await tx.status.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
    if (input.isDefault) await tx.status.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const slug = await freeSlug(slugify(input.name), async (c) => Boolean(await tx.status.findUnique({ where: { slug: c } })));
    return tx.status.create({
      data: {
        name: input.name,
        slug,
        color: input.color,
        sortOrder,
        isDefault: Boolean(input.isDefault),
        votingOpen: input.votingOpen,
        closesCommentsOnEntry: input.closesCommentsOnEntry,
        showOnRoadmap: input.showOnRoadmap,
      },
    });
  });
  await audit({ action: "status.create", actor, targetType: "status", targetId: created.id, details: { name: input.name }, request });
  return { id: created.id };
}

export async function updateStatus(actor: User, id: string, input: StatusInput, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const current = await tx.status.findUnique({ where: { id } });
    if (!current) throw notFound("Status not found.");
    if (current.isDefault && input.isDefault === false) {
      throw badRequest("Pick another default status instead of turning this one off.", "default_required");
    }
    if (
      input.name.toLowerCase() !== current.name.toLowerCase() &&
      (await tx.status.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, NOT: { id } } }))
    ) {
      throw conflict("duplicate_name", "A status with that name already exists.");
    }
    if (input.isDefault && !current.isDefault) {
      await tx.status.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    await tx.status.update({
      where: { id },
      data: {
        name: input.name,
        color: input.color,
        votingOpen: input.votingOpen,
        closesCommentsOnEntry: input.closesCommentsOnEntry,
        showOnRoadmap: input.showOnRoadmap,
        ...(input.isDefault ? { isDefault: true } : {}),
      },
    });
  });
  await audit({ action: "status.update", actor, targetType: "status", targetId: id, details: { ...input }, request });
}

export async function deleteStatus(actor: User, id: string, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const status = await tx.status.findUnique({ where: { id } });
    if (!status) throw notFound("Status not found.");
    if (status.isDefault) throw conflict("is_default", "The default status can't be deleted. Choose another default first.");
    const inUse = await tx.suggestion.count({ where: { statusId: id } });
    if (inUse > 0) {
      throw conflict("in_use", `${inUse} suggestion${inUse === 1 ? " is" : "s are"} in this status. Move ${inUse === 1 ? "it" : "them"} first.`);
    }
    await tx.status.delete({ where: { id } });
  });
  await audit({ action: "status.delete", actor, targetType: "status", targetId: id, request });
}

export const reorderStatuses = (actor: User, ids: string[]) =>
  reorder(actor, ids, () => prisma.status.findMany({ select: { id: true } }), (tx, id, sortOrder) =>
    tx.status.update({ where: { id }, data: { sortOrder } }),
  );

// ── Types ────────────────────────────────────────────────────────────

type TypeInput = z.infer<typeof typeSchema>;

export async function createType(actor: User, input: TypeInput, request?: Request): Promise<{ id: string }> {
  assertOwner(actor);
  const created = await prisma.$transaction(async (tx) => {
    if ((await tx.suggestionType.count()) >= LIMITS.maxTypes) {
      throw conflict("too_many", `You can have up to ${LIMITS.maxTypes} types.`);
    }
    if (await tx.suggestionType.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) {
      throw conflict("duplicate_name", "A type with that name already exists.");
    }
    const sortOrder = ((await tx.suggestionType.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
    const slug = await freeSlug(slugify(input.name), async (c) => Boolean(await tx.suggestionType.findUnique({ where: { slug: c } })));
    return tx.suggestionType.create({
      data: {
        name: input.name,
        slug,
        description: input.description || null,
        color: input.color,
        icon: input.icon,
        enabled: input.enabled,
        sortOrder,
      },
    });
  });
  await audit({ action: "type.create", actor, targetType: "type", targetId: created.id, details: { name: input.name }, request });
  return { id: created.id };
}

export async function updateType(actor: User, id: string, input: TypeInput, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const current = await tx.suggestionType.findUnique({ where: { id } });
    if (!current) throw notFound("Type not found.");
    if (
      input.name.toLowerCase() !== current.name.toLowerCase() &&
      (await tx.suggestionType.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, NOT: { id } } }))
    ) {
      throw conflict("duplicate_name", "A type with that name already exists.");
    }
    await tx.suggestionType.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description || null,
        color: input.color,
        icon: input.icon,
        enabled: input.enabled,
      },
    });
  });
  await audit({ action: "type.update", actor, targetType: "type", targetId: id, details: { ...input }, request });
}

export async function deleteType(actor: User, id: string, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    if (!(await tx.suggestionType.findUnique({ where: { id } }))) throw notFound("Type not found.");
    const inUse = await tx.suggestion.count({ where: { typeId: id } });
    if (inUse > 0) {
      throw conflict("in_use", `${inUse} suggestion${inUse === 1 ? " uses" : "s use"} this type. Turn it off instead; existing suggestions keep it.`);
    }
    await tx.suggestionType.delete({ where: { id } });
  });
  await audit({ action: "type.delete", actor, targetType: "type", targetId: id, request });
}

export const reorderTypes = (actor: User, ids: string[]) =>
  reorder(actor, ids, () => prisma.suggestionType.findMany({ select: { id: true } }), (tx, id, sortOrder) =>
    tx.suggestionType.update({ where: { id }, data: { sortOrder } }),
  );

// ── Tags ─────────────────────────────────────────────────────────────

type TagInput = z.infer<typeof tagSchema>;

export async function createTag(actor: User, input: TagInput, request?: Request): Promise<{ id: string }> {
  assertOwner(actor);
  const created = await prisma.$transaction(async (tx) => {
    if ((await tx.tag.count()) >= LIMITS.maxTags) throw conflict("too_many", `You can have up to ${LIMITS.maxTags} tags.`);
    if (await tx.tag.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) {
      throw conflict("duplicate_name", "A tag with that name already exists.");
    }
    const sortOrder = ((await tx.tag.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
    const slug = await freeSlug(slugify(input.name, 32), async (c) => Boolean(await tx.tag.findUnique({ where: { slug: c } })));
    return tx.tag.create({ data: { name: input.name, slug, color: input.color, sortOrder } });
  });
  await audit({ action: "tag.create", actor, targetType: "tag", targetId: created.id, details: { name: input.name }, request });
  return { id: created.id };
}

export async function updateTag(actor: User, id: string, input: TagInput, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const current = await tx.tag.findUnique({ where: { id } });
    if (!current) throw notFound("Tag not found.");
    if (
      input.name.toLowerCase() !== current.name.toLowerCase() &&
      (await tx.tag.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, NOT: { id } } }))
    ) {
      throw conflict("duplicate_name", "A tag with that name already exists.");
    }
    await tx.tag.update({ where: { id }, data: { name: input.name, color: input.color } });
  });
  await audit({ action: "tag.update", actor, targetType: "tag", targetId: id, details: { ...input }, request });
}

/** Deleting a tag removes it from every suggestion that had it. */
export async function deleteTag(actor: User, id: string, request?: Request): Promise<void> {
  assertOwner(actor);
  const result = await prisma.tag.deleteMany({ where: { id } });
  if (result.count === 0) throw notFound("Tag not found.");
  await audit({ action: "tag.delete", actor, targetType: "tag", targetId: id, request });
}

export const reorderTags = (actor: User, ids: string[]) =>
  reorder(actor, ids, () => prisma.tag.findMany({ select: { id: true } }), (tx, id, sortOrder) =>
    tx.tag.update({ where: { id }, data: { sortOrder } }),
  );

// ── Guidelines ───────────────────────────────────────────────────────

type GuidelineInput = z.infer<typeof guidelineSchema>;

/** Any change to the guidelines' wording means people need to confirm them again. */
async function bumpGuidelinesVersion(tx: Tx): Promise<void> {
  await tx.settings.update({ where: { id: 1 }, data: { guidelinesVersion: { increment: 1 } } });
}

async function checkTypeIds(tx: Tx, input: GuidelineInput): Promise<string[]> {
  if (input.appliesToAll) return [];
  const typeIds = [...new Set(input.typeIds)];
  if (typeIds.length === 0) throw badRequest("Choose at least one type, or apply it to everything.", "no_types");
  if ((await tx.suggestionType.count({ where: { id: { in: typeIds } } })) !== typeIds.length) {
    throw badRequest("One of those types no longer exists.", "invalid_type");
  }
  return typeIds;
}

export async function createGuideline(actor: User, input: GuidelineInput, request?: Request): Promise<{ id: string }> {
  assertOwner(actor);
  const created = await prisma.$transaction(async (tx) => {
    if ((await tx.guideline.count()) >= LIMITS.maxGuidelines) {
      throw conflict("too_many", `You can have up to ${LIMITS.maxGuidelines} guidelines.`);
    }
    const typeIds = await checkTypeIds(tx, input);
    const sortOrder = ((await tx.guideline.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
    const g = await tx.guideline.create({
      data: {
        title: input.title,
        body: input.body,
        appliesToAll: input.appliesToAll,
        sortOrder,
        types: { create: typeIds.map((typeId) => ({ typeId })) },
      },
    });
    await bumpGuidelinesVersion(tx);
    return g;
  });
  await audit({ action: "guideline.create", actor, targetType: "guideline", targetId: created.id, request });
  return { id: created.id };
}

export async function updateGuideline(actor: User, id: string, input: GuidelineInput, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    if (!(await tx.guideline.findUnique({ where: { id } }))) throw notFound("Guideline not found.");
    const typeIds = await checkTypeIds(tx, input);
    await tx.guideline.update({
      where: { id },
      data: { title: input.title, body: input.body, appliesToAll: input.appliesToAll },
    });
    await tx.guidelineType.deleteMany({ where: { guidelineId: id } });
    if (typeIds.length) await tx.guidelineType.createMany({ data: typeIds.map((typeId) => ({ guidelineId: id, typeId })) });
    await bumpGuidelinesVersion(tx);
  });
  await audit({ action: "guideline.update", actor, targetType: "guideline", targetId: id, request });
}

export async function deleteGuideline(actor: User, id: string, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const result = await tx.guideline.deleteMany({ where: { id } });
    if (result.count === 0) throw notFound("Guideline not found.");
    await bumpGuidelinesVersion(tx);
  });
  await audit({ action: "guideline.delete", actor, targetType: "guideline", targetId: id, request });
}

export const reorderGuidelines = (actor: User, ids: string[]) =>
  reorder(actor, ids, () => prisma.guideline.findMany({ select: { id: true } }), (tx, id, sortOrder) =>
    tx.guideline.update({ where: { id }, data: { sortOrder } }),
  );
