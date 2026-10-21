import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { moveSuggestion } from "@/server/suggestions";
import { castVote, getVoteBudget, retractVote, strikeAllVotes, strikeVote } from "@/server/votes";
import { configureSite, makeApproved, makePending, makeUser, resetDb, statusBySlug } from "./helpers/db";

beforeEach(async () => {
  await resetDb();
  await configureSite({ voteSlots: 3 });
});

describe("vote slots", () => {
  it("lets a member vote until their slots run out, then stops them", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const items = await Promise.all([1, 2, 3, 4].map((n) => makeApproved(author, `Idea number ${n} for the board`)));

    for (const s of items.slice(0, 3)) await castVote(voter, s.publicId);
    expect(await getVoteBudget(voter.id)).toEqual({ total: 3, used: 3, remaining: 0 });

    await expect(castVote(voter, items[3]!.publicId)).rejects.toMatchObject({ status: 409, code: "out_of_votes" });
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: items[3]!.id } })).voteCount).toBe(0);
  });

  it("never lets simultaneous requests slip past the limit", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const items = await Promise.all(Array.from({ length: 10 }, (_, n) => makeApproved(author, `Concurrent idea ${n + 1} on the board`)));

    const results = await Promise.allSettled(items.map((s) => castVote(voter, s.publicId)));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await prisma.vote.count({ where: { userId: voter.id } })).toBe(3);
    const total = await prisma.suggestion.aggregate({ _sum: { voteCount: true } });
    expect(total._sum.voteCount).toBe(3);
  });

  it("is one vote per person per suggestion, and repeating a vote is harmless", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const s = await makeApproved(author);

    await castVote(voter, s.publicId);
    const again = await castVote(voter, s.publicId);

    expect(again.voteCount).toBe(1);
    expect(await prisma.vote.count({ where: { suggestionId: s.id } })).toBe(1);
    expect(again.budget.used).toBe(1);
  });

  it("keeps the tally right when many people vote at once", async () => {
    const author = await makeUser();
    const s = await makeApproved(author);
    const voters = await Promise.all(Array.from({ length: 12 }, () => makeUser()));

    await Promise.all(voters.map((v) => castVote(v, s.publicId)));

    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).voteCount).toBe(12);
  });

  it("gives the slot back when a vote is withdrawn", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const [a, b, c, d] = await Promise.all(["a", "b", "c", "d"].map((x) => makeApproved(author, `Idea ${x} is quite a good one`)));
    for (const s of [a, b, c]) await castVote(voter, s!.publicId);

    const after = await retractVote(voter, a!.publicId);
    expect(after.budget.remaining).toBe(1);
    expect(after.voteCount).toBe(0);

    await castVote(voter, d!.publicId);
    expect((await getVoteBudget(voter.id)).remaining).toBe(0);
  });

  it("frees the slot, but keeps the tally, when the owner moves it somewhere voting is closed", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const voter = await makeUser();
    const items = await Promise.all([1, 2, 3, 4].map((n) => makeApproved(author, `Slot idea ${n} for the roadmap`)));
    for (const s of items.slice(0, 3)) await castVote(voter, s.publicId);

    const planned = await statusBySlug("planned");
    const result = await moveSuggestion(owner, items[0]!.publicId, planned.id);

    expect(result.votesReturned).toBe(1);
    expect((await getVoteBudget(voter.id)).remaining).toBe(1);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: items[0]!.id } })).voteCount).toBe(1);

    // The freed slot can be spent elsewhere.
    await castVote(voter, items[3]!.publicId);
    // The voter was told their vote came back.
    const notice = await prisma.notice.findFirstOrThrow({ where: { userId: voter.id } });
    expect(notice).toMatchObject({ kind: "STATUS_CHANGED", voteReturned: true, statusName: "Planned" });
  });

  it("refuses new votes, and withdrawals, once voting has closed for that suggestion", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const voter = await makeUser();
    const other = await makeUser();
    const s = await makeApproved(author);
    await castVote(voter, s.publicId);
    await moveSuggestion(owner, s.publicId, (await statusBySlug("planned")).id);

    await expect(castVote(other, s.publicId)).rejects.toMatchObject({ code: "voting_closed" });
    await expect(retractVote(voter, s.publicId)).rejects.toMatchObject({ code: "voting_closed" });
  });

  it("supports unlimited votes when the owner turns the limit off", async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { voteSlots: null } });
    const author = await makeUser();
    const voter = await makeUser();
    for (let n = 0; n < 8; n++) await castVote(voter, (await makeApproved(author, `Unlimited idea ${n + 1} for all`)).publicId);
    expect(await getVoteBudget(voter.id)).toEqual({ total: null, used: 8, remaining: null });
  });

  it("does not count votes against a lowered limit retroactively, but blocks adding more", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const items = await Promise.all([1, 2, 3, 4].map((n) => makeApproved(author, `Lowered idea ${n} for the test`)));
    for (const s of items.slice(0, 3)) await castVote(voter, s.publicId);

    await prisma.settings.update({ where: { id: 1 }, data: { voteSlots: 1 } });

    expect(await prisma.vote.count({ where: { userId: voter.id } })).toBe(3);
    await expect(castVote(voter, items[3]!.publicId)).rejects.toMatchObject({ code: "out_of_votes" });
  });
});

describe("who may vote", () => {
  it("refuses people without the Member role, blocked people, and people too new to the server", async () => {
    const author = await makeUser();
    const s = await makeApproved(author);

    await expect(castVote(await makeUser({ member: false }), s.publicId)).rejects.toMatchObject({ code: "not_member" });
    await expect(castVote(await makeUser({ blocked: true }), s.publicId)).rejects.toMatchObject({ code: "blocked" });

    await prisma.settings.update({ where: { id: 1 }, data: { minDaysInServer: 7 } });
    await expect(castVote(await makeUser({ joinedDaysAgo: 2 }), s.publicId)).rejects.toMatchObject({ code: "too_new" });
    await expect(castVote(await makeUser({ joinedDaysAgo: 10 }), s.publicId)).resolves.toBeTruthy();
  });

  it("will not accept a vote on something still waiting for approval", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const pending = await makePending(author);
    await expect(castVote(voter, pending.publicId)).rejects.toMatchObject({ status: 404 });
  });

  it("lets the owner vote even though they do not hold the Member role", async () => {
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    await expect(castVote(owner, s.publicId)).resolves.toMatchObject({ voteCount: 1 });
  });
});

describe("owner tools", () => {
  it("strikes one vote or all of a person's votes and keeps tallies right", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const voter = await makeUser();
    const [a, b] = await Promise.all([makeApproved(author, "First struck idea here"), makeApproved(author, "Second struck idea here")]);
    await castVote(voter, a.publicId);
    await castVote(voter, b.publicId);

    await strikeVote(owner, a.publicId, voter.id);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: a.id } })).voteCount).toBe(0);

    expect(await strikeAllVotes(owner, voter.id)).toBe(1);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: b.id } })).voteCount).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "vote.strike" } } })).toBe(2);
  });

  it("refuses everyone else", async () => {
    const member = await makeUser();
    const s = await makeApproved(await makeUser());
    await expect(strikeVote(member, s.publicId, member.id)).rejects.toMatchObject({ status: 403 });
    await expect(strikeAllVotes(member, member.id)).rejects.toMatchObject({ status: 403 });
  });
});
