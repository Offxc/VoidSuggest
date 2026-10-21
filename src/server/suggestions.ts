import type { z } from "zod";
import { Prisma, prisma, type Settings, type User } from "./db";
import type { createSuggestionSchema, editSuggestionSchema } from "../shared/schemas";
import { audit } from "./audit";
import { randomPublicId } from "./crypto";
import { participationBlock } from "./eligibility";
import { badRequest, conflict, forbidden, notFound } from "./errors";
import { createNotices, type NewNotice } from "./notices";
import { getSettings } from "./settings";
import { announcePending, announceStatusChange } from "./webhook";

type Tx = Prisma.TransactionClient;
type CreateInput = z.infer<typeof createSuggestionSchema>;
type EditInput = z.infer<typeof editSuggestionSchema>;

/**
 * Everything that changes a suggestion: submitting, editing, approving,
 * rejecting, moving between statuses, comment settings and deletion. Each
 * function re-checks who is allowed to do it; the API layer's checks are a
 * first line, not the only one.
 */

function assertOwner(actor: User): void {
  if (!actor.isOwner) throw forbidden();
}

/** Locks one suggestion row for the rest of the transaction and returns its id. */
async function lockSuggestion(tx: Tx, publicId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Suggestion" WHERE "publicId" = ${publicId} FOR NO KEY UPDATE`;
  if (!rows[0]) throw notFound("Suggestion not found.");
  return rows[0].id;
}

async function unusedPublicId(tx: Tx): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const candidate = randomPublicId();
    if (!(await tx.suggestion.findUnique({ where: { publicId: candidate }, select: { id: true } }))) return candidate;
  }
  throw new Error("Could not allocate a suggestion id");
}

/** Checks the chosen type and tags exist and respect the owner's settings. */
async function checkClassification(
  tx: Tx,
  settings: Pick<Settings, "maxTagsPerSuggestion">,
  input: { typeId?: string | null; tagIds?: string[] },
  current?: { typeId: string | null },
): Promise<{ typeId: string | null; tagIds: string[] | undefined }> {
  let typeId: string | null = current?.typeId ?? null;

  if (input.typeId !== undefined) {
    if (input.typeId === null) {
      typeId = null;
    } else if (input.typeId !== current?.typeId) {
      const type = await tx.suggestionType.findUnique({ where: { id: input.typeId } });
      if (!type || !type.enabled) throw badRequest("That type isn't available.", "invalid_type");
      typeId = type.id;
    }
  }

  // If any type is switched on, one must be chosen. With none on, the field is skipped.
  if (typeId === null && (!current || input.typeId !== undefined)) {
    const enabled = await tx.suggestionType.count({ where: { enabled: true } });
    if (enabled > 0) throw badRequest("Pick a type for your suggestion.", "type_required");
  }

  let tagIds: string[] | undefined;
  if (input.tagIds !== undefined) {
    tagIds = [...new Set(input.tagIds)];
    if (tagIds.length > settings.maxTagsPerSuggestion) {
      throw badRequest(`You can add up to ${settings.maxTagsPerSuggestion} tags.`, "too_many_tags");
    }
    const found = await tx.tag.count({ where: { id: { in: tagIds } } });
    if (found !== tagIds.length) throw badRequest("One of those tags no longer exists.", "invalid_tag");
  }
  return { typeId, tagIds };
}

// ── Submitting ───────────────────────────────────────────────────────

export async function createSuggestion(
  actor: User,
  input: CreateInput,
  request?: Request,
): Promise<{ publicId: string; approval: "PENDING" | "APPROVED" }> {
  const settings = await getSettings();
  const block = participationBlock(actor, settings);
  if (block) throw forbidden(block.message, block.code);

  if (!actor.isOwner) {
    if (!settings.submissionsOpen) {
      throw conflict("submissions_closed", "New suggestions are paused right now.");
    }
    if (
      settings.requireGuidelinesAck &&
      actor.ackedGuidelinesVersion < settings.guidelinesVersion &&
      !input.acknowledgeGuidelines
    ) {
      throw badRequest("Please confirm you've read the guidelines.", "guidelines_required");
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    // Serialise this person's submissions so the limits below can't be raced past.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR NO KEY UPDATE`;

    const { typeId, tagIds } = await checkClassification(tx, settings, { typeId: input.typeId ?? null, tagIds: input.tagIds });

    if (!actor.isOwner) {
      const pending = await tx.suggestion.count({ where: { authorId: actor.id, approval: "PENDING" } });
      if (pending >= settings.maxPendingPerUser) {
        throw conflict(
          "too_many_pending",
          `You already have ${pending} suggestion${pending === 1 ? "" : "s"} waiting for approval. Please wait for them to be reviewed.`,
        );
      }
      const lastDay = await tx.suggestion.count({
        where: { authorId: actor.id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      });
      if (lastDay >= settings.maxSubmissionsPerDay) {
        throw conflict(
          "daily_limit",
          `You can post ${settings.maxSubmissionsPerDay} suggestion${settings.maxSubmissionsPerDay === 1 ? "" : "s"} a day. Try again tomorrow.`,
        );
      }
    }

    // The owner's own suggestions skip the queue.
    const defaultStatus = actor.isOwner ? await tx.status.findFirst({ where: { isDefault: true } }) : null;
    const now = new Date();

    const suggestion = await tx.suggestion.create({
      data: {
        publicId: await unusedPublicId(tx),
        authorId: actor.id,
        title: input.title,
        body: input.body,
        typeId,
        ...(defaultStatus
          ? {
              approval: "APPROVED" as const,
              statusId: defaultStatus.id,
              approvedAt: now,
              statusChangedAt: now,
              commentsMode: settings.defaultCommentsMode,
            }
          : {}),
        tags: tagIds?.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        timeline: {
          create: [{ kind: "SUBMITTED" as const }, ...(defaultStatus ? [{ kind: "APPROVED" as const, toStatusName: defaultStatus.name }] : [])],
        },
      },
      include: { type: true },
    });

    if (input.acknowledgeGuidelines) {
      await tx.user.update({ where: { id: actor.id }, data: { ackedGuidelinesVersion: settings.guidelinesVersion } });
    }
    return suggestion;
  });

  await audit({ action: "suggestion.submit", actor, targetType: "suggestion", targetId: created.publicId, request });
  if (created.approval === "PENDING") {
    void announcePending({
      publicId: created.publicId,
      title: created.title,
      body: created.body,
      authorName: actor.displayName,
      typeName: created.type?.name ?? null,
    });
  }
  return { publicId: created.publicId, approval: created.approval === "PENDING" ? "PENDING" : "APPROVED" };
}

// ── Editing and deleting ─────────────────────────────────────────────

export async function updateSuggestion(actor: User, publicId: string, input: EditInput, request?: Request): Promise<void> {
  const settings = await getSettings();

  const editedByOwner = await prisma.$transaction(async (tx) => {
    const id = await lockSuggestion(tx, publicId);
    const s = await tx.suggestion.findUniqueOrThrow({ where: { id } });
    const isAuthor = s.authorId === actor.id;

    if (!actor.isOwner) {
      // Other people's unapproved suggestions are invisible, so say "not found" rather than "forbidden".
      if (!isAuthor && s.approval !== "APPROVED") throw notFound("Suggestion not found.");
      if (!isAuthor || s.approval !== "PENDING") {
        throw forbidden("Only suggestions waiting for approval can be edited.", "locked");
      }
      const block = participationBlock(actor, settings, { tenure: false });
      if (block) throw forbidden(block.message, block.code);
    }

    const { typeId, tagIds } = await checkClassification(
      tx,
      settings,
      { typeId: input.typeId, tagIds: input.tagIds },
      { typeId: s.typeId },
    );

    await tx.suggestion.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.typeId !== undefined ? { typeId } : {}),
      },
    });
    if (tagIds) {
      await tx.suggestionTag.deleteMany({ where: { suggestionId: id } });
      if (tagIds.length) await tx.suggestionTag.createMany({ data: tagIds.map((tagId) => ({ suggestionId: id, tagId })) });
    }

    const publicEdit = actor.isOwner && s.approval === "APPROVED";
    if (publicEdit) await tx.timelineEvent.create({ data: { suggestionId: id, kind: "EDITED" } });
    return actor.isOwner;
  });

  if (editedByOwner) {
    await audit({
      action: "suggestion.edit",
      actor,
      targetType: "suggestion",
      targetId: publicId,
      details: { fields: Object.keys(input) },
      request,
    });
  }
}

export async function deleteSuggestion(actor: User, publicId: string, request?: Request): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const id = await lockSuggestion(tx, publicId);
    const s = await tx.suggestion.findUniqueOrThrow({ where: { id } });
    if (!actor.isOwner) {
      if (s.authorId !== actor.id) throw notFound("Suggestion not found.");
      if (s.approval === "APPROVED") {
        throw forbidden("Approved suggestions can't be withdrawn, because people have voted on them.", "locked");
      }
    }
    await tx.suggestion.delete({ where: { id } });
  });
  if (actor.isOwner) {
    await audit({ action: "suggestion.delete", actor, targetType: "suggestion", targetId: publicId, request });
  }
}

// ── Approval ─────────────────────────────────────────────────────────

export async function approveSuggestion(actor: User, publicId: string, request?: Request): Promise<void> {
  assertOwner(actor);
  const settings = await getSettings();
  await prisma.$transaction(async (tx) => {
    const id = await lockSuggestion(tx, publicId);
    const s = await tx.suggestion.findUniqueOrThrow({ where: { id } });
    if (s.approval === "APPROVED") return;
    const status = await tx.status.findFirst({ where: { isDefault: true } });
    if (!status) throw conflict("no_default_status", "Choose a default status in Settings first.");
    const now = new Date();
    await tx.suggestion.update({
      where: { id },
      data: {
        approval: "APPROVED",
        statusId: status.id,
        rejectionReason: null,
        approvedAt: now,
        statusChangedAt: now,
        commentsMode: settings.defaultCommentsMode,
      },
    });
    await tx.timelineEvent.create({ data: { suggestionId: id, kind: "APPROVED", toStatusName: status.name } });
    await createNotices(tx, [
      { userId: s.authorId, kind: "SUGGESTION_APPROVED", suggestionId: id, suggestionTitle: s.title, statusName: status.name },
    ]);
  });
  await audit({ action: "suggestion.approve", actor, targetType: "suggestion", targetId: publicId, request });
}

export async function rejectSuggestion(actor: User, publicId: string, reason: string | undefined, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const id = await lockSuggestion(tx, publicId);
    const s = await tx.suggestion.findUniqueOrThrow({ where: { id } });
    if (s.approval !== "PENDING") {
      throw conflict("not_pending", "Only suggestions waiting for approval can be rejected. Move or delete it instead.");
    }
    await tx.suggestion.update({
      where: { id },
      data: { approval: "REJECTED", rejectionReason: reason || null },
    });
    await createNotices(tx, [
      { userId: s.authorId, kind: "SUGGESTION_REJECTED", suggestionId: id, suggestionTitle: s.title },
    ]);
  });
  await audit({ action: "suggestion.reject", actor, targetType: "suggestion", targetId: publicId, request });
}

// ── Moving between statuses ──────────────────────────────────────────

export interface MoveResult {
  statusName: string;
  commentsClosed: boolean;
  votesReturned: number;
}

/**
 * Moves an approved suggestion to another status. In one transaction this:
 *  - closes its comments, if the new status is set to do that,
 *  - records the change on the public timeline,
 *  - tells the author and everyone who voted, and
 *  - frees the vote slots if the new status no longer accepts votes (the
 *    freeing itself is automatic: slots are counted from open suggestions).
 */
export async function moveSuggestion(actor: User, publicId: string, statusId: string, request?: Request): Promise<MoveResult> {
  assertOwner(actor);

  const { result, announce } = await prisma.$transaction(async (tx) => {
    const id = await lockSuggestion(tx, publicId);
    const s = await tx.suggestion.findUniqueOrThrow({ where: { id }, include: { status: true } });
    if (s.approval !== "APPROVED" || !s.status) {
      throw conflict("not_approved", "Approve this suggestion before moving it.");
    }
    const to = await tx.status.findUnique({ where: { id: statusId } });
    if (!to) throw notFound("That status no longer exists.");
    if (to.id === s.status.id) {
      const unchanged: MoveResult = { statusName: to.name, commentsClosed: false, votesReturned: 0 };
      return { result: unchanged, announce: null };
    }

    const closeComments = to.closesCommentsOnEntry && s.commentsMode === "OPEN";
    await tx.suggestion.update({
      where: { id },
      data: { statusId: to.id, statusChangedAt: new Date(), ...(closeComments ? { commentsMode: "CLOSED" } : {}) },
    });
    await tx.timelineEvent.create({
      data: { suggestionId: id, kind: "STATUS_CHANGED", fromStatusName: s.status.name, toStatusName: to.name },
    });
    if (closeComments) await tx.timelineEvent.create({ data: { suggestionId: id, kind: "COMMENTS_CLOSED" } });

    const freed = s.status.votingOpen && !to.votingOpen;
    const voters = await tx.vote.findMany({ where: { suggestionId: id }, select: { userId: true } });
    const recipients = new Set<string>([s.authorId, ...voters.map((v) => v.userId)]);
    const voterIds = new Set(voters.map((v) => v.userId));
    const notices: NewNotice[] = [...recipients].map((userId) => ({
      userId,
      kind: "STATUS_CHANGED",
      suggestionId: id,
      suggestionTitle: s.title,
      statusName: to.name,
      voteReturned: freed && voterIds.has(userId),
    }));
    await createNotices(tx, notices);

    const moved: MoveResult = { statusName: to.name, commentsClosed: closeComments, votesReturned: freed ? voters.length : 0 };
    return { result: moved, announce: { title: s.title, toStatus: to.name } };
  });

  if (announce) {
    await audit({
      action: "suggestion.move",
      actor,
      targetType: "suggestion",
      targetId: publicId,
      details: { to: result.statusName, commentsClosed: result.commentsClosed },
      request,
    });
    void announceStatusChange({ publicId, title: announce.title, toStatus: announce.toStatus });
  }
  return result;
}

// ── Comments on/off ──────────────────────────────────────────────────

export async function setCommentsMode(
  actor: User,
  publicId: string,
  mode: "OFF" | "OPEN" | "CLOSED",
  request?: Request,
): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const id = await lockSuggestion(tx, publicId);
    const s = await tx.suggestion.findUniqueOrThrow({ where: { id } });
    if (s.approval !== "APPROVED") throw conflict("not_approved", "Approve this suggestion first.");
    if (s.commentsMode === mode) return;
    if (mode === "OFF" && s.commentCount > 0) {
      throw conflict("has_comments", "This suggestion has comments. Close the thread instead, so they stay visible.");
    }
    await tx.suggestion.update({ where: { id }, data: { commentsMode: mode } });
    if (mode === "OPEN") await tx.timelineEvent.create({ data: { suggestionId: id, kind: "COMMENTS_OPENED" } });
    if (mode === "CLOSED") await tx.timelineEvent.create({ data: { suggestionId: id, kind: "COMMENTS_CLOSED" } });
  });
  await audit({
    action: "suggestion.comments_mode",
    actor,
    targetType: "suggestion",
    targetId: publicId,
    details: { mode },
    request,
  });
}
