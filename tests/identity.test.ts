import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { ensureFresh, sweepMembers } from "@/server/identity";
import { castVote } from "@/server/votes";
import { configureSite, makeApproved, makeUser, resetDb } from "./helpers/db";
import { MEMBER_ROLE, MockDiscord } from "./helpers/mock-discord";

const discord = new MockDiscord();

beforeAll(async () => {
  await discord.start();
});
afterAll(async () => {
  await discord.stop();
});
beforeEach(async () => {
  await resetDb();
  await configureSite();
  discord.failWith = null;
  discord.requests.length = 0;
  discord.members.clear();
});

async function memberLinkedToDiscord(name: string, discordId: string, extra: { nick?: string | null } = {}) {
  const user = await makeUser({ name });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { discordId } });
  discord.add({ id: discordId, username: name.toLowerCase(), nick: extra.nick ?? null, roles: [MEMBER_ROLE] });
  return updated;
}

describe("keeping names and roles in step with Discord", () => {
  it("picks up a changed server nickname for people who haven't visited lately", async () => {
    const user = await memberLinkedToDiscord("Old Name", "700000000000000001");
    discord.members.get(user.discordId)!.nick = "Brand New Nick";

    const result = await sweepMembers();

    expect(result).toMatchObject({ updated: 1, left: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).displayName).toBe("Brand New Nick");
  });

  it("revokes the Member role: they stop being a member and their open votes are withdrawn", async () => {
    const user = await memberLinkedToDiscord("Soon Removed", "700000000000000002");
    const s = await makeApproved(await makeUser());
    await castVote(user, s.publicId);

    discord.members.get(user.discordId)!.roles = [];
    await sweepMembers();

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isMember).toBe(false);
    expect(await prisma.vote.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).voteCount).toBe(0);
  });

  it("keeps their votes if the owner has turned the clean-up off", async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { removeVotesOnLeave: false } });
    const user = await memberLinkedToDiscord("Keeps Votes", "700000000000000003");
    const s = await makeApproved(await makeUser());
    await castVote(user, s.publicId);

    discord.members.get(user.discordId)!.roles = [];
    await sweepMembers();

    expect(await prisma.vote.count({ where: { userId: user.id } })).toBe(1);
  });

  it("notices someone who left the server, and welcomes them back", async () => {
    const user = await memberLinkedToDiscord("Leaver", "700000000000000004");
    await memberLinkedToDiscord("Stayer", "700000000000000005");
    discord.members.get(user.discordId)!.inGuild = false;

    expect(await sweepMembers()).toMatchObject({ left: 1 });
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(gone).toMatchObject({ isMember: false });
    expect(gone.leftGuildAt).not.toBeNull();

    discord.members.get(user.discordId)!.inGuild = true;
    await sweepMembers();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ isMember: true, leftGuildAt: null });
  });

  it("does not mark anyone as having left when the member list can't be read", async () => {
    await memberLinkedToDiscord("Innocent", "700000000000000006");
    discord.failWith = 500;
    await expect(sweepMembers()).rejects.toBeTruthy();
    discord.failWith = null;
    expect((await prisma.user.findFirstOrThrow({ where: { discordId: "700000000000000006" } })).isMember).toBe(true);
  });

  it("refreshes a stale record before a write, and fails closed if Discord can't be asked", async () => {
    const user = await memberLinkedToDiscord("Stale", "700000000000000007", { nick: "Fresh Nick" });
    await prisma.user.update({ where: { id: user.id }, data: { lastSyncedAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const stale = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    discord.failWith = 503;
    await expect(ensureFresh(stale)).rejects.toMatchObject({ status: 503, code: "discord_unavailable" });

    discord.failWith = null;
    expect((await ensureFresh(stale)).displayName).toBe("Fresh Nick");
  });

  it("doesn't call Discord at all when the record is recent", async () => {
    const user = await makeUser();
    await ensureFresh(user);
    expect(discord.requests).toHaveLength(0);
  });

  it("never locks the owner out because Discord is down", async () => {
    const owner = await makeUser({ owner: true });
    await prisma.user.update({ where: { id: owner.id }, data: { lastSyncedAt: new Date(0) } });
    discord.failWith = 500;
    const stale = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    await expect(ensureFresh(stale)).resolves.toMatchObject({ id: owner.id });
  });
});
