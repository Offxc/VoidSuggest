import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addComment, deleteComment } from "@/server/comments";
import { findSimilar, getBoard, getComments, getRoadmap, getSuggestion } from "@/server/queries";
import { rejectSuggestion, setCommentsMode } from "@/server/suggestions";
import { boardQuerySchema } from "@/shared/schemas";
import { configureSite, makeApproved, makePending, makeUser, resetDb } from "./helpers/db";

const board = (viewer: Parameters<typeof getBoard>[0] = null) => getBoard(viewer, boardQuerySchema.parse({}));

beforeEach(async () => {
  await resetDb();
  await configureSite();
});

describe("unapproved suggestions stay private", () => {
  it("never appear on the board, roadmap or in similar-suggestion search", async () => {
    const author = await makeUser();
    const owner = await makeUser({ owner: true });
    const pending = await makePending(author, "Unicorn mounts for everyone online");
    const rejectedSource = await makePending(author, "Unicorn armour for all the players");
    await rejectSuggestion(owner, rejectedSource.publicId, "No");
    await makeApproved(author, "Visible dragon mounts for the server");

    for (const viewer of [null, await makeUser(), author]) {
      const result = await board(viewer);
      expect(result.items.map((i) => i.title)).toEqual(["Visible dragon mounts for the server"]);
      expect(result.statuses.reduce((n, s) => n + s.count, 0)).toBe(1);
    }
    const roadmap = await getRoadmap(null);
    expect(roadmap.flatMap((c) => c.items)).toHaveLength(0);
    // The approved "dragon mounts" suggestion may match; the unicorn ones, still pending or rejected, must not.
    const hits = await findSimilar("unicorn mounts armour");
    expect(hits.map((h) => h.title)).toEqual(["Visible dragon mounts for the server"]);
    expect(pending.approval).toBe("PENDING");
  });

  it("can be opened only by the author and the owner, and everyone else gets the same answer as for a missing page", async () => {
    const author = await makeUser();
    const stranger = await makeUser();
    const owner = await makeUser({ owner: true });
    const pending = await makePending(author);

    expect(await getSuggestion(null, pending.publicId)).toBeNull();
    expect(await getSuggestion(stranger, pending.publicId)).toBeNull();
    expect(await getSuggestion(author, pending.publicId)).toMatchObject({ approval: "PENDING", viewerIsAuthor: true });
    expect(await getSuggestion(owner, pending.publicId)).toMatchObject({ approval: "PENDING" });
    expect(await getSuggestion(null, "ZZZZZZZZ")).toBeNull();
  });

  it("shares a rejection reason with the author and owner only", async () => {
    const author = await makeUser();
    const stranger = await makeUser();
    const owner = await makeUser({ owner: true });
    const s = await makePending(author);
    await rejectSuggestion(owner, s.publicId, "Out of scope for this server");

    expect((await getSuggestion(author, s.publicId))?.rejectionReason).toBe("Out of scope for this server");
    expect((await getSuggestion(owner, s.publicId))?.rejectionReason).toBe("Out of scope for this server");
    expect(await getSuggestion(stranger, s.publicId)).toBeNull();
  });
});

describe("what leaves the server", () => {
  it("never includes Discord ids, emails or internal flags in anything shown to the public", async () => {
    const author = await makeUser({ name: "Visible Author" });
    const s = await makeApproved(author);
    const voter = await makeUser();
    await prisma.vote.create({ data: { suggestionId: s.id, userId: voter.id } });

    const payload = JSON.stringify([await board(null), await getSuggestion(null, s.publicId), await getRoadmap(null)]);

    expect(payload).toContain("Visible Author");
    expect(payload).not.toContain(author.discordId);
    expect(payload).not.toContain(voter.discordId);
    expect(payload).not.toContain(voter.displayName);
    expect(payload).not.toMatch(/sessionVersion|blockedAt|isMember|joinedGuildAt/);
  });
});

describe("comments", () => {
  it("stay hidden until the owner turns them on, then open, then can be closed but remain readable", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const commenter = await makeUser();
    const s = await makeApproved(author);

    await expect(addComment(commenter, s.publicId, "Hello")).rejects.toMatchObject({ code: "comments_off" });
    expect(await getComments(null, s.publicId)).toEqual([]);

    await setCommentsMode(owner, s.publicId, "OPEN");
    await addComment(commenter, s.publicId, "Great idea, would use it daily");
    expect((await getComments(null, s.publicId))[0]).toMatchObject({ body: "Great idea, would use it daily" });

    await setCommentsMode(owner, s.publicId, "CLOSED");
    await expect(addComment(commenter, s.publicId, "Too late")).rejects.toMatchObject({ code: "comments_closed" });
    expect(await getComments(null, s.publicId)).toHaveLength(1);
  });

  it("show deleted comments as removed without exposing the text, and keep the count right", async () => {
    const owner = await makeUser({ owner: true });
    const commenter = await makeUser();
    const s = await makeApproved(await makeUser());
    await setCommentsMode(owner, s.publicId, "OPEN");
    const { id } = await addComment(commenter, s.publicId, "Something I regret writing");

    await deleteComment(commenter, id);

    const [comment] = await getComments(null, s.publicId);
    expect(comment).toMatchObject({ deleted: true, body: null });
    expect(JSON.stringify(comment)).not.toContain("regret");
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).commentCount).toBe(0);
  });

  it("can't be switched fully off once there are comments, so nothing disappears silently", async () => {
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    await setCommentsMode(owner, s.publicId, "OPEN");
    await addComment(await makeUser(), s.publicId, "A comment that should stay put");
    await expect(setCommentsMode(owner, s.publicId, "OFF")).rejects.toMatchObject({ code: "has_comments" });
  });
});
