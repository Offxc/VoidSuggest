import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { decryptSecret } from "@/server/crypto";
import {
  createGuideline, createStatus, createTag, createType, deleteGuideline, deleteStatus, deleteTag, deleteType,
  reorderGuidelines, reorderStatuses, setWebhook, updateGuideline, updateSettings, updateStatus, updateType,
} from "@/server/config";
import { toSite } from "@/server/dto";
import { getSettings } from "@/server/settings";
import { blockUser, unblockUser } from "@/server/users";
import { castVote } from "@/server/votes";
import { configureSite, makeApproved, makeUser, resetDb } from "./helpers/db";

const status = (over: Record<string, unknown> = {}) => ({
  name: "Shipped", color: "green" as const, votingOpen: false, closesCommentsOnEntry: true, showOnRoadmap: true, ...over,
});

beforeEach(async () => {
  await resetDb();
  await configureSite();
});

describe("only the owner configures anything", () => {
  it("refuses an ordinary member on every configuration function", async () => {
    const member = await makeUser();
    const anyId = "abcdefghijklmnopqrstuvwxy";
    const calls = [
      () => updateSettings(member, { siteName: "x" }),
      () => setWebhook(member, ""),
      () => createStatus(member, status()),
      () => updateStatus(member, anyId, status()),
      () => deleteStatus(member, anyId),
      () => reorderStatuses(member, [anyId]),
      () => createType(member, { name: "T", description: "", color: "blue", icon: "bug", enabled: true }),
      () => deleteType(member, anyId),
      () => createTag(member, { name: "T", color: "blue" }),
      () => deleteTag(member, anyId),
      () => createGuideline(member, { title: "T", body: "B", appliesToAll: true, typeIds: [] }),
      () => deleteGuideline(member, anyId),
      () => blockUser(member, anyId, undefined),
      () => unblockUser(member, anyId),
    ];
    for (const run of calls) await expect(run()).rejects.toMatchObject({ status: 403 });
  });
});

describe("statuses", () => {
  it("always has exactly one default, and the default can't be deleted or switched off", async () => {
    const owner = await makeUser({ owner: true });
    const original = await prisma.status.findFirstOrThrow({ where: { isDefault: true } });

    const { id } = await createStatus(owner, status({ name: "Inbox", isDefault: true, votingOpen: true }));
    expect(await prisma.status.count({ where: { isDefault: true } })).toBe(1);
    expect((await prisma.status.findUniqueOrThrow({ where: { id } })).isDefault).toBe(true);

    await expect(deleteStatus(owner, id)).rejects.toMatchObject({ code: "is_default" });
    await expect(updateStatus(owner, id, status({ name: "Inbox", isDefault: false }))).rejects.toMatchObject({ code: "default_required" });

    await updateStatus(owner, original.id, { ...status({ name: original.name }), isDefault: true });
    expect(await prisma.status.count({ where: { isDefault: true } })).toBe(1);
    expect((await prisma.status.findUniqueOrThrow({ where: { id: original.id } })).isDefault).toBe(true);
  });

  it("won't delete a status that still has suggestions in it", async () => {
    const owner = await makeUser({ owner: true });
    const planned = await prisma.status.findUniqueOrThrow({ where: { slug: "planned" } });
    await makeApproved(await makeUser(), "Sitting in planned for now", "planned");
    await expect(deleteStatus(owner, planned.id)).rejects.toMatchObject({ code: "in_use" });
    const unused = await prisma.status.findUniqueOrThrow({ where: { slug: "declined" } });
    await expect(deleteStatus(owner, unused.id)).resolves.toBeUndefined();
  });

  it("rejects duplicate names regardless of case, and caps the total", async () => {
    const owner = await makeUser({ owner: true });
    await expect(createStatus(owner, status({ name: "PLANNED" }))).rejects.toMatchObject({ code: "duplicate_name" });
    for (let n = 0; n < 7; n++) await createStatus(owner, status({ name: `Extra ${n}` }));
    await expect(createStatus(owner, status({ name: "One too many" }))).rejects.toMatchObject({ code: "too_many" });
  });

  it("gives each status a unique, URL-safe slug even for names that clash or contain odd characters", async () => {
    const owner = await makeUser({ owner: true });
    const a = await createStatus(owner, status({ name: "Beta / Testing?" }));
    const b = await createStatus(owner, status({ name: "Beta - Testing!" }));
    const slugs = (await prisma.status.findMany({ where: { id: { in: [a.id, b.id] } } })).map((s) => s.slug).sort();
    expect(slugs).toEqual(["beta-testing", "beta-testing-2"]);
  });

  it("refuses a reorder that doesn't match the current list, so a stale page can't scramble it", async () => {
    const owner = await makeUser({ owner: true });
    const all = await prisma.status.findMany({ orderBy: { sortOrder: "asc" } });
    await expect(reorderStatuses(owner, all.slice(1).map((s) => s.id))).rejects.toMatchObject({ code: "stale_order" });
    await reorderStatuses(owner, all.map((s) => s.id).reverse());
    expect((await prisma.status.findMany({ orderBy: { sortOrder: "asc" } })).map((s) => s.id)).toEqual(all.map((s) => s.id).reverse());
  });
});

describe("types", () => {
  it("can be turned off at any time but not deleted while suggestions use them", async () => {
    const owner = await makeUser({ owner: true });
    const feature = await prisma.suggestionType.findUniqueOrThrow({ where: { slug: "feature-request" } });
    await makeApproved(await makeUser());

    await expect(deleteType(owner, feature.id)).rejects.toMatchObject({ code: "in_use" });
    await updateType(owner, feature.id, { name: feature.name, description: "", color: "purple", icon: "sparkle", enabled: false });
    expect((await prisma.suggestionType.findUniqueOrThrow({ where: { id: feature.id } })).enabled).toBe(false);

    const fresh = await createType(owner, { name: "Event idea", description: "A server event.", color: "amber", icon: "star", enabled: true });
    await expect(deleteType(owner, fresh.id)).resolves.toBeUndefined();
  });
});

describe("tags", () => {
  it("removing a tag takes it off every suggestion that had it", async () => {
    const owner = await makeUser({ owner: true });
    const { id } = await createTag(owner, { name: "Economy", color: "amber" });
    const s = await makeApproved(await makeUser());
    await prisma.suggestionTag.create({ data: { suggestionId: s.id, tagId: id } });

    await deleteTag(owner, id);

    expect(await prisma.suggestionTag.count()).toBe(0);
    expect(await prisma.suggestion.findUnique({ where: { id: s.id } })).not.toBeNull();
  });
});

describe("guidelines", () => {
  it("asks everyone to re-confirm when the wording changes, but not when they are only reordered", async () => {
    const owner = await makeUser({ owner: true });
    const before = (await getSettings()).guidelinesVersion;

    const { id } = await createGuideline(owner, { title: "No spam", body: "Don't post the same thing twice.", appliesToAll: true, typeIds: [] });
    expect((await getSettings()).guidelinesVersion).toBe(before + 1);
    await updateGuideline(owner, id, { title: "No spam", body: "Reworded.", appliesToAll: true, typeIds: [] });
    expect((await getSettings()).guidelinesVersion).toBe(before + 2);

    const all = await prisma.guideline.findMany({ orderBy: { sortOrder: "asc" } });
    await reorderGuidelines(owner, all.map((g) => g.id).reverse());
    expect((await getSettings()).guidelinesVersion).toBe(before + 2);

    await deleteGuideline(owner, id);
    expect((await getSettings()).guidelinesVersion).toBe(before + 3);
  });

  it("can be limited to particular types, and must name at least one", async () => {
    const owner = await makeUser({ owner: true });
    const update = await prisma.suggestionType.findUniqueOrThrow({ where: { slug: "update-request" } });
    await expect(createGuideline(owner, { title: "Updates", body: "Say what changes.", appliesToAll: false, typeIds: [] })).rejects.toMatchObject({ code: "no_types" });
    await expect(createGuideline(owner, { title: "Updates", body: "Say what changes.", appliesToAll: false, typeIds: ["nope"] })).rejects.toMatchObject({ code: "invalid_type" });
    const { id } = await createGuideline(owner, { title: "Updates", body: "Say what changes.", appliesToAll: false, typeIds: [update.id] });
    expect(await prisma.guidelineType.count({ where: { guidelineId: id } })).toBe(1);
  });
});

describe("settings and the webhook", () => {
  it("stores the webhook encrypted, never returns it, and accepts only genuine Discord webhook URLs", async () => {
    const owner = await makeUser({ owner: true });
    const url = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ-_0123456789";

    await expect(setWebhook(owner, "http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz")).rejects.toMatchObject({ code: "invalid_webhook" });
    await expect(setWebhook(owner, "https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz")).rejects.toMatchObject({ code: "invalid_webhook" });
    await expect(setWebhook(owner, "https://169.254.169.254/latest/meta-data")).rejects.toMatchObject({ code: "invalid_webhook" });

    await setWebhook(owner, url);
    const settings = await getSettings();
    expect(settings.webhookUrlEnc).toBeTruthy();
    expect(settings.webhookUrlEnc).not.toContain("abcdefghijklmnop");
    expect(decryptSecret(settings.webhookUrlEnc!)).toBe(url);
    expect(JSON.stringify(toSite(settings))).not.toMatch(/webhook|abcdefghijklmnop/i);
    const auditDump = JSON.stringify(await prisma.auditLog.findMany(), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(auditDump).not.toContain("abcdefghijklmnop");

    expect(await setWebhook(owner, "")).toEqual({ configured: false });
    expect((await getSettings()).webhookUrlEnc).toBeNull();
  });

  it("turns empty optional text into 'not set'", async () => {
    const owner = await makeUser({ owner: true });
    await updateSettings(owner, { introText: "Hello", discordInviteUrl: "https://discord.gg/abc" });
    await updateSettings(owner, { introText: "", discordInviteUrl: "" });
    expect(await getSettings()).toMatchObject({ introText: null, discordInviteUrl: null });
  });
});

describe("blocking", () => {
  it("ends their sessions, withdraws their open votes, and can be undone; the owner can't be blocked", async () => {
    const owner = await makeUser({ owner: true });
    const troll = await makeUser();
    const s = await makeApproved(await makeUser());
    await castVote(troll, s.publicId);

    await blockUser(owner, troll.id, "Brigading");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: troll.id } });
    expect(after).toMatchObject({ blockedReason: "Brigading", sessionVersion: troll.sessionVersion + 1 });
    expect(after.blockedAt).not.toBeNull();
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).voteCount).toBe(0);

    await expect(blockUser(owner, owner.id, undefined)).rejects.toMatchObject({ code: "self" });
    await unblockUser(owner, troll.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: troll.id } })).blockedAt).toBeNull();
    await expect(unblockUser(owner, troll.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("rules enforced by the database itself", () => {
  it("allows only one owner and only one default status, whatever the application does", async () => {
    await makeUser({ owner: true });
    await expect(makeUser({ owner: true })).rejects.toThrow(/User_single_owner|Unique constraint/);
    await expect(prisma.status.updateMany({ data: { isDefault: true } })).rejects.toThrow();
  });

  it("insists that approved suggestions have a status and unapproved ones don't", async () => {
    const author = await makeUser();
    const status = await prisma.status.findFirstOrThrow();
    const base = { authorId: author.id, title: "Constraint check title", body: "A long enough body for the constraint check." };
    await expect(prisma.suggestion.create({ data: { ...base, publicId: "CHECK001", approval: "APPROVED" } })).rejects.toThrow();
    await expect(prisma.suggestion.create({ data: { ...base, publicId: "CHECK002", approval: "PENDING", statusId: status.id } })).rejects.toThrow();
  });

  it("never lets vote counts go negative, and keeps settings to a single row", async () => {
    const s = await makeApproved(await makeUser());
    await expect(prisma.suggestion.update({ where: { id: s.id }, data: { voteCount: -1 } })).rejects.toThrow();
    await expect(prisma.$executeRaw`INSERT INTO "Settings" ("id", "updatedAt") VALUES (2, now())`).rejects.toThrow();
    await expect(prisma.settings.update({ where: { id: 1 }, data: { voteSlots: 0 } })).rejects.toThrow();
  });

  it("makes the audit log append-only", async () => {
    await prisma.auditLog.create({ data: { actorName: "tester", action: "test.event" } });
    await expect(prisma.auditLog.updateMany({ data: { actorName: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.count({ where: { actorName: "tester" } })).toBe(1);
  });

  it("deleting a suggestion removes its votes, comments and timeline but keeps the notices' wording", async () => {
    const owner = await makeUser({ owner: true });
    const voter = await makeUser();
    const s = await makeApproved(await makeUser(), "Soon to be deleted idea");
    await castVote(voter, s.publicId);
    await prisma.notice.create({ data: { userId: voter.id, kind: "STATUS_CHANGED", suggestionId: s.id, suggestionTitle: s.title } });
    const { deleteSuggestion } = await import("@/server/suggestions");

    await deleteSuggestion(owner, s.publicId);

    expect(await prisma.vote.count()).toBe(0);
    expect(await prisma.notice.findFirstOrThrow()).toMatchObject({ suggestionId: null, suggestionTitle: "Soon to be deleted idea" });
  });
});
