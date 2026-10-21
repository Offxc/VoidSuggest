import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addComment, editComment } from "@/server/comments";
import { deleteSuggestion, createSuggestion, approveSuggestion, moveSuggestion, rejectSuggestion, setCommentsMode, updateSuggestion } from "@/server/suggestions";
import { configureSite, makeApproved, makePending, makeUser, resetDb, statusBySlug } from "./helpers/db";

const input = (over: Record<string, unknown> = {}) => ({
  title: "Add a spawn market for trading",
  body: "A central place where players can trade items with each other safely.",
  typeId: undefined as string | null | undefined,
  tagIds: [] as string[],
  ...over,
});

async function featureType() {
  return prisma.suggestionType.findFirstOrThrow({ where: { slug: "feature-request" } });
}

beforeEach(async () => {
  await resetDb();
  await configureSite();
});

describe("submitting", () => {
  it("puts a member's suggestion in the approval queue and the owner's straight onto the board", async () => {
    const member = await makeUser();
    const owner = await makeUser({ owner: true });
    const type = await featureType();

    const mine = await createSuggestion(member, input({ typeId: type.id }));
    const theirs = await createSuggestion(owner, input({ typeId: type.id, title: "Owner's own good idea here" }));

    expect(mine.approval).toBe("PENDING");
    expect(theirs.approval).toBe("APPROVED");
    const stored = await prisma.suggestion.findUniqueOrThrow({ where: { publicId: mine.publicId } });
    expect(stored).toMatchObject({ approval: "PENDING", statusId: null, voteCount: 0 });
  });

  it("limits how many a person can have waiting, and per day, but not the owner", async () => {
    const member = await makeUser();
    const type = await featureType();
    await prisma.settings.update({ where: { id: 1 }, data: { maxPendingPerUser: 2, maxSubmissionsPerDay: 5 } });

    await createSuggestion(member, input({ typeId: type.id, title: "First suggestion goes in OK" }));
    await createSuggestion(member, input({ typeId: type.id, title: "Second suggestion goes in OK" }));
    await expect(createSuggestion(member, input({ typeId: type.id, title: "Third is one too many" }))).rejects.toMatchObject({ code: "too_many_pending" });

    await prisma.settings.update({ where: { id: 1 }, data: { maxPendingPerUser: 50, maxSubmissionsPerDay: 2 } });
    await expect(createSuggestion(member, input({ typeId: type.id, title: "Daily cap should stop this" }))).rejects.toMatchObject({ code: "daily_limit" });

    const owner = await makeUser({ owner: true });
    for (let n = 0; n < 4; n++) await createSuggestion(owner, input({ typeId: type.id, title: `Owner suggestion number ${n + 1}` }));
  });

  it("can't be raced past the pending limit by firing requests together", async () => {
    const member = await makeUser();
    const type = await featureType();
    await prisma.settings.update({ where: { id: 1 }, data: { maxPendingPerUser: 2, maxSubmissionsPerDay: 50 } });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, n) => createSuggestion(member, input({ typeId: type.id, title: `Racing suggestion number ${n + 1}` }))),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await prisma.suggestion.count({ where: { authorId: member.id } })).toBe(2);
  });

  it("follows the owner's type rules: required when any type is on, only enabled ones, optional when none are", async () => {
    const member = await makeUser();
    const feature = await featureType();
    const update = await prisma.suggestionType.findFirstOrThrow({ where: { slug: "update-request" } });

    await expect(createSuggestion(member, input())).rejects.toMatchObject({ code: "type_required" });
    await expect(createSuggestion(member, input({ typeId: "does-not-exist" }))).rejects.toMatchObject({ code: "invalid_type" });

    await prisma.suggestionType.update({ where: { id: update.id }, data: { enabled: false } });
    await expect(createSuggestion(member, input({ typeId: update.id }))).rejects.toMatchObject({ code: "invalid_type" });
    await expect(createSuggestion(member, input({ typeId: feature.id }))).resolves.toBeTruthy();

    await prisma.suggestionType.updateMany({ data: { enabled: false } });
    await expect(createSuggestion(member, input({ title: "No type needed this time round" }))).resolves.toBeTruthy();
  });

  it("enforces the tag limit and rejects tags that don't exist", async () => {
    const member = await makeUser();
    const type = await featureType();
    const tags = await Promise.all(["a", "b", "c", "d"].map((n, i) => prisma.tag.create({ data: { name: `Tag ${n}`, slug: `tag-${n}`, sortOrder: i } })));
    await prisma.settings.update({ where: { id: 1 }, data: { maxTagsPerSuggestion: 2 } });

    await expect(createSuggestion(member, input({ typeId: type.id, tagIds: tags.map((t) => t.id) }))).rejects.toMatchObject({ code: "too_many_tags" });
    await expect(createSuggestion(member, input({ typeId: type.id, tagIds: ["nope"] }))).rejects.toMatchObject({ code: "invalid_tag" });
    await expect(createSuggestion(member, input({ typeId: type.id, tagIds: [tags[0]!.id, tags[1]!.id] }))).resolves.toBeTruthy();
  });

  it("can be paused by the owner, and can require the guidelines to be acknowledged", async () => {
    const member = await makeUser();
    const owner = await makeUser({ owner: true });
    const type = await featureType();

    await prisma.settings.update({ where: { id: 1 }, data: { submissionsOpen: false } });
    await expect(createSuggestion(member, input({ typeId: type.id }))).rejects.toMatchObject({ code: "submissions_closed" });
    await expect(createSuggestion(owner, input({ typeId: type.id }))).resolves.toBeTruthy();

    await prisma.settings.update({ where: { id: 1 }, data: { submissionsOpen: true, requireGuidelinesAck: true } });
    await expect(createSuggestion(member, input({ typeId: type.id }))).rejects.toMatchObject({ code: "guidelines_required" });
    await createSuggestion(member, input({ typeId: type.id, acknowledgeGuidelines: true }));
    // Acknowledged once for this version, so not asked again until the guidelines change.
    const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    await expect(createSuggestion(reloaded, input({ typeId: type.id, title: "Second one without a tick box" }))).resolves.toBeTruthy();

    // Changing the guidelines asks everyone to confirm again.
    await prisma.settings.update({ where: { id: 1 }, data: { guidelinesVersion: { increment: 1 } } });
    await expect(createSuggestion(reloaded, input({ typeId: type.id, title: "Third after guidelines changed" }))).rejects.toMatchObject({ code: "guidelines_required" });
  });

  it("is closed to people without the Member role and to blocked people", async () => {
    const type = await featureType();
    await expect(createSuggestion(await makeUser({ member: false }), input({ typeId: type.id }))).rejects.toMatchObject({ code: "not_member" });
    await expect(createSuggestion(await makeUser({ blocked: true }), input({ typeId: type.id }))).rejects.toMatchObject({ code: "blocked" });
  });
});

describe("approval", () => {
  it("approving moves it to the default status, opens the board to it, and tells the author", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const s = await makePending(author);

    await approveSuggestion(owner, s.publicId);

    const stored = await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id }, include: { status: true } });
    expect(stored).toMatchObject({ approval: "APPROVED" });
    expect(stored.status?.isDefault).toBe(true);
    expect(await prisma.notice.count({ where: { userId: author.id, kind: "SUGGESTION_APPROVED" } })).toBe(1);
    // Approving twice changes nothing.
    await approveSuggestion(owner, s.publicId);
    expect(await prisma.notice.count({ where: { userId: author.id } })).toBe(1);
  });

  it("rejecting records the reason and tells the author; only pending ones can be rejected", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const s = await makePending(author);
    await rejectSuggestion(owner, s.publicId, "Doesn't fit the server");

    expect(await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ approval: "REJECTED", rejectionReason: "Doesn't fit the server" });
    expect(await prisma.notice.count({ where: { userId: author.id, kind: "SUGGESTION_REJECTED" } })).toBe(1);
    await expect(rejectSuggestion(owner, s.publicId, "again")).rejects.toMatchObject({ code: "not_pending" });
    const approved = await makeApproved(author);
    await expect(rejectSuggestion(owner, approved.publicId, "late")).rejects.toMatchObject({ code: "not_pending" });
  });

  it("only the owner can approve, reject, move or change comment settings", async () => {
    const member = await makeUser();
    const s = await makePending(await makeUser());
    const planned = await statusBySlug("planned");
    await expect(approveSuggestion(member, s.publicId)).rejects.toMatchObject({ status: 403 });
    await expect(rejectSuggestion(member, s.publicId, undefined)).rejects.toMatchObject({ status: 403 });
    await expect(moveSuggestion(member, s.publicId, planned.id)).rejects.toMatchObject({ status: 403 });
    await expect(setCommentsMode(member, s.publicId, "OPEN")).rejects.toMatchObject({ status: 403 });
  });

  it("applies the owner's default comment setting to newly approved suggestions", async () => {
    const owner = await makeUser({ owner: true });
    await prisma.settings.update({ where: { id: 1 }, data: { defaultCommentsMode: "OPEN" } });
    const s = await makePending(await makeUser());
    await approveSuggestion(owner, s.publicId);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).commentsMode).toBe("OPEN");
  });
});

describe("moving between statuses", () => {
  it("closes comments when the new status is set to, and records it on the timeline", async () => {
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    await setCommentsMode(owner, s.publicId, "OPEN");

    const completed = await statusBySlug("completed");
    const result = await moveSuggestion(owner, s.publicId, completed.id);

    expect(result).toMatchObject({ statusName: "Completed", commentsClosed: true });
    const stored = await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id }, include: { timeline: true } });
    expect(stored.commentsMode).toBe("CLOSED");
    expect(stored.timeline.map((t) => t.kind).sort()).toEqual(["COMMENTS_CLOSED", "COMMENTS_OPENED", "STATUS_CHANGED"]);
  });

  it("leaves comments alone when the status isn't set to close them, or when they were never on", async () => {
    const owner = await makeUser({ owner: true });
    const a = await makeApproved(await makeUser(), "Comments stay open on this one");
    const b = await makeApproved(await makeUser(), "Comments were never on for this");
    await setCommentsMode(owner, a.publicId, "OPEN");

    await moveSuggestion(owner, a.publicId, (await statusBySlug("planned")).id);
    await moveSuggestion(owner, b.publicId, (await statusBySlug("completed")).id);

    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: a.id } })).commentsMode).toBe("OPEN");
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: b.id } })).commentsMode).toBe("OFF");
  });

  it("can be switched on for any status, so a custom 'shipped' status can close comments too", async () => {
    const owner = await makeUser({ owner: true });
    const planned = await statusBySlug("planned");
    await prisma.status.update({ where: { id: planned.id }, data: { closesCommentsOnEntry: true } });
    const s = await makeApproved(await makeUser());
    await setCommentsMode(owner, s.publicId, "OPEN");
    await moveSuggestion(owner, s.publicId, planned.id);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).commentsMode).toBe("CLOSED");
  });

  it("refuses to move something that isn't approved, or to a status that doesn't exist", async () => {
    const owner = await makeUser({ owner: true });
    const pending = await makePending(await makeUser());
    const planned = await statusBySlug("planned");
    await expect(moveSuggestion(owner, pending.publicId, planned.id)).rejects.toMatchObject({ code: "not_approved" });
    const approved = await makeApproved(await makeUser());
    await expect(moveSuggestion(owner, approved.publicId, "missing")).rejects.toMatchObject({ status: 404 });
  });
});

describe("editing and withdrawing", () => {
  it("the author can edit and withdraw while pending; after approval only the owner can change it", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const stranger = await makeUser();
    const pending = await makePending(author);

    await updateSuggestion(author, pending.publicId, { title: "A much better title for it" });
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: pending.id } })).title).toBe("A much better title for it");
    await expect(updateSuggestion(stranger, pending.publicId, { title: "Hijacked title here" })).rejects.toMatchObject({ status: 404 });

    await approveSuggestion(owner, pending.publicId);
    await expect(updateSuggestion(author, pending.publicId, { title: "Sneaky change after votes" })).rejects.toMatchObject({ code: "locked" });
    await expect(deleteSuggestion(author, pending.publicId)).rejects.toMatchObject({ code: "locked" });

    await updateSuggestion(owner, pending.publicId, { title: "Owner tidied this title up" });
    const stored = await prisma.suggestion.findUniqueOrThrow({ where: { id: pending.id }, include: { timeline: true } });
    expect(stored.title).toBe("Owner tidied this title up");
    expect(stored.timeline.some((t) => t.kind === "EDITED")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "suggestion.edit" } })).toBe(1);
  });

  it("the author can withdraw a pending one, a stranger can't, and the owner can delete anything", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const stranger = await makeUser();
    const mine = await makePending(author);
    const theirs = await makePending(author, "Another pending suggestion");
    const live = await makeApproved(author, "An approved suggestion to delete");

    await expect(deleteSuggestion(stranger, mine.publicId)).rejects.toMatchObject({ status: 404 });
    await deleteSuggestion(author, mine.publicId);
    expect(await prisma.suggestion.findUnique({ where: { id: mine.id } })).toBeNull();

    await deleteSuggestion(owner, theirs.publicId);
    await deleteSuggestion(owner, live.publicId);
    expect(await prisma.auditLog.count({ where: { action: "suggestion.delete" } })).toBe(2);
  });
});

describe("comment permissions", () => {
  it("only the author edits their comment, and only for a short time", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const other = await makeUser();
    const s = await makeApproved(await makeUser());
    await setCommentsMode(owner, s.publicId, "OPEN");
    const { id } = await addComment(author, s.publicId, "First draft of my comment");

    await editComment(author, id, "Second draft of my comment");
    await expect(editComment(other, id, "Not yours to edit")).rejects.toMatchObject({ status: 404 });
    await expect(editComment(author, id, "Far too late now", Date.now() + 60 * 60 * 1000)).rejects.toMatchObject({ code: "edit_window_passed" });
  });
});
