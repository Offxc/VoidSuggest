import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/discord/interactions/route";
import { configureBoardForTests } from "@/server/board";
import { prisma } from "@/server/db";
import { resetRateLimitsForTests } from "@/server/rate-limit";
import { moveSuggestion } from "@/server/suggestions";
import { castVote, getVoteBudget } from "@/server/votes";
import { buttonClick, ping, removeInteractionKey, signedCall, useInteractionKey } from "./helpers/interactions";
import { MockDiscord } from "./helpers/mock-discord";
import { configureSite, makeApproved, makeUser, resetDb, statusBySlug } from "./helpers/db";

/**
 * Buttons on Discord posts. These talk to the real endpoint with real
 * signatures; the vote rules themselves are the same code the site uses, so
 * what matters here is who is believed, what is said, and that Discord and
 * the site share one pool of vote slots.
 */

const discord = new MockDiscord();
const CHANNEL = "900000000000000001";

beforeAll(async () => {
  await discord.start();
  useInteractionKey();
  configureBoardForTests({ timers: false, pauseMs: 0 });
});
afterAll(async () => {
  await discord.stop();
  removeInteractionKey();
});
beforeEach(async () => {
  await resetDb();
  await configureSite({ voteSlots: 3, discordBoardEnabled: true, discordChannelId: CHANNEL });
  resetRateLimitsForTests();
  discord.messages.clear();
});

const click = (customId: string, who: { discordId: string; roles?: string[]; joinedDaysAgo?: number }, extra: object = {}) =>
  signedCall(POST, { ...buttonClick({ customId, ...who }), ...extra });

const content = (res: { json: any }) => res.json.data.content as string;
const buttons = (res: { json: any }) => (res.json.data.components[0]?.components ?? []) as { label: string; custom_id?: string; url?: string; style: number }[];
const newcomer = () => ({ discordId: String(600000000000000000n + BigInt(Math.floor(Math.random() * 1e12))) });

describe("who may call the endpoint", () => {
  it("answers Discord's check with a pong", async () => {
    const res = await signedCall(POST, ping());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ type: 1 });
  });

  it("turns away a request with no signature", async () => {
    const res = await signedCall(POST, ping(), { unsigned: true });
    expect(res.status).toBe(401);
  });

  it("turns away a well-formed signature made with anyone else's key", async () => {
    const author = await makeUser();
    const s = await makeApproved(author);
    const forged = buttonClick({ customId: `v:y:${s.publicId}`, ...newcomer() });
    const res = await signedCall(POST, forged, { wrongKey: true });
    expect(res.status).toBe(401);
    expect(await prisma.vote.count()).toBe(0);
    expect(await prisma.user.count()).toBe(1);
  });

  it("turns away a request whose body was changed after it was signed", async () => {
    const res = await signedCall(POST, ping(), { tamper: (b) => b.replace("ping-token", "evil-token") });
    expect(res.status).toBe(401);
  });

  it("turns away a request signed for another moment, so a captured one cannot be replayed", async () => {
    const old = await signedCall(POST, ping(), { timestamp: Math.floor(Date.now() / 1000) - 3600 });
    const future = await signedCall(POST, ping(), { timestamp: Math.floor(Date.now() / 1000) + 3600 });
    expect(old.status).toBe(401);
    expect(future.status).toBe(401);
  });

  it("turns away everything when no public key is configured", async () => {
    removeInteractionKey();
    try {
      expect((await signedCall(POST, ping())).status).toBe(401);
    } finally {
      useInteractionKey();
    }
  });

  it("does not read the request, or touch the database, before the signature checks out", async () => {
    const who = newcomer();
    const res = await signedCall(POST, buttonClick({ customId: "v:a:ABCDEFGH", ...who }), { unsigned: true });
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });

  it("records a failed signature in the audit log", async () => {
    // A fresh address: repeats from one address are only logged once a minute.
    await signedCall(POST, ping(), { unsigned: true, ip: "198.51.100.77" });
    expect(await prisma.auditLog.findFirst({ where: { action: "discord.bad_signature" } })).toMatchObject({ outcome: "DENIED", ip: "198.51.100.77" });
  });

  it("refuses requests meant for another application", async () => {
    const res = await signedCall(POST, buttonClick({ customId: "v:a:ABCDEFGH", ...newcomer(), applicationId: "100000000000000999" }));
    expect(res.status).toBe(400);
  });

  it("refuses clicks from another server", async () => {
    const author = await makeUser();
    const s = await makeApproved(author);
    const res = await signedCall(POST, buttonClick({ customId: `v:a:${s.publicId}`, ...newcomer(), guildId: "200000000000000999" }));
    expect(content(res)).toMatch(/only works in the server/);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe("voting from Discord", () => {
  it("shows how many votes are left and asks for confirmation, privately, without voting yet", async () => {
    const s = await makeApproved(await makeUser(), "Bigger villager trading halls");
    const voter = await makeUser();

    const res = await click(`v:a:${s.publicId}`, voter);

    expect(res.json.type).toBe(4);
    expect(res.json.data.flags & 64).toBe(64);
    expect(content(res)).toContain("3 of 3");
    expect(content(res)).toContain("Bigger villager trading halls");
    expect(buttons(res).map((b) => b.label)).toEqual(["Confirm vote", "Cancel"]);
    expect(buttons(res)[0]!.custom_id).toBe(`v:y:${s.publicId}`);
    expect(await prisma.vote.count()).toBe(0);
  });

  it("casts the vote on confirmation and says how many are left", async () => {
    const s = await makeApproved(await makeUser());
    const voter = await makeUser();

    const res = await click(`v:y:${s.publicId}`, voter);

    expect(res.json.type).toBe(7);
    expect(content(res)).toContain("is in");
    expect(content(res)).toContain("2 of 3");
    expect(buttons(res)).toEqual([]);
    expect(await prisma.vote.count({ where: { userId: voter.id, suggestionId: s.id } })).toBe(1);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).voteCount).toBe(1);
  });

  it("changes nothing when the person cancels", async () => {
    const s = await makeApproved(await makeUser());
    const voter = await makeUser();
    const res = await click(`v:n:${s.publicId}`, voter);
    expect(content(res)).toMatch(/nothing changed/i);
    expect(await prisma.vote.count()).toBe(0);
  });

  it("counts the votes someone already cast on the site", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const [a, b, c] = await Promise.all(["one", "two", "three"].map((n) => makeApproved(author, `Idea number ${n} here`)));
    await castVote(voter, a!.publicId);
    await castVote(voter, b!.publicId);

    const res = await click(`v:a:${c!.publicId}`, voter);

    expect(content(res)).toContain("1 of 3");
  });

  it("and the other way round: a vote cast in Discord uses a slot on the site too", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const items = await Promise.all([1, 2, 3, 4].map((n) => makeApproved(author, `Shared pool idea ${n} here`)));
    for (const s of items.slice(0, 3)) await click(`v:y:${s.publicId}`, voter);

    expect(await getVoteBudget(voter.id)).toEqual({ total: 3, used: 3, remaining: 0 });
    await expect(castVote(voter, items[3]!.publicId)).rejects.toMatchObject({ code: "out_of_votes" });
  });

  it("tells someone with no votes left, and offers no way to spend one", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const items = await Promise.all([1, 2, 3, 4].map((n) => makeApproved(author, `Out of votes idea ${n} here`)));
    for (const s of items.slice(0, 3)) await castVote(voter, s.publicId);

    const res = await click(`v:a:${items[3]!.publicId}`, voter);

    expect(res.json.type).toBe(4);
    expect(content(res)).toMatch(/used all \*\*3\*\* of your votes/);
    expect(buttons(res).some((b) => b.custom_id?.startsWith("v:y:"))).toBe(false);
    expect(buttons(res).map((b) => b.label)).toEqual(["Manage my votes"]);
  });

  it("refuses a confirm click that arrives after the votes ran out, and says why", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const items = await Promise.all([1, 2, 3, 4].map((n) => makeApproved(author, `Late confirm idea ${n} here`)));
    for (const s of items.slice(0, 3)) await castVote(voter, s.publicId);

    const res = await click(`v:y:${items[3]!.publicId}`, voter);

    expect(content(res)).toMatch(/used all/);
    expect(await prisma.vote.count({ where: { userId: voter.id } })).toBe(3);
  });

  it("never lets quick repeated confirms pass the limit", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const items = await Promise.all(Array.from({ length: 8 }, (_, n) => makeApproved(author, `Race idea ${n + 1} on the board`)));

    await Promise.all(items.map((s) => click(`v:y:${s.publicId}`, voter)));

    expect(await prisma.vote.count({ where: { userId: voter.id } })).toBe(3);
  });

  it("offers to take back a vote already cast, and gives the slot back", async () => {
    const author = await makeUser();
    const voter = await makeUser();
    const s = await makeApproved(author);
    await castVote(voter, s.publicId);

    const ask = await click(`v:a:${s.publicId}`, voter);
    expect(content(ask)).toMatch(/already voted/);
    expect(buttons(ask).map((b) => b.label)).toEqual(["Remove my vote", "Keep it"]);

    const done = await click(`v:r:${s.publicId}`, voter);
    expect(content(done)).toContain("was removed");
    expect(content(done)).toContain("3 of 3");
    expect(await prisma.vote.count()).toBe(0);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).voteCount).toBe(0);
  });

  it("is one vote per person per suggestion, however many times it is confirmed", async () => {
    const s = await makeApproved(await makeUser());
    const voter = await makeUser();
    await click(`v:y:${s.publicId}`, voter);
    const again = await click(`v:y:${s.publicId}`, voter);
    expect(content(again)).toContain("2 of 3");
    expect(await prisma.vote.count()).toBe(1);
  });

  it("says votes are unlimited when the owner has set no limit", async () => {
    await configureSite({ voteSlots: null });
    const s = await makeApproved(await makeUser());
    const res = await click(`v:a:${s.publicId}`, await makeUser());
    expect(content(res)).toContain("unlimited");
  });
});

describe("stages where voting is closed", () => {
  it("locks the same suggestions the site locks, and no others", async () => {
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const voter = await makeUser();
    const s = await makeApproved(author, "Something that will get planned");
    const planned = await statusBySlug("planned");

    await moveSuggestion(owner, s.publicId, planned.id);

    const ask = await click(`v:a:${s.publicId}`, voter);
    expect(content(ask)).toMatch(/Voting is closed/);
    expect(content(ask)).toContain("Planned");
    expect(buttons(ask)).toEqual([]);

    const confirm = await click(`v:y:${s.publicId}`, voter);
    expect(content(confirm)).toMatch(/Voting is closed/);
    expect(await prisma.vote.count()).toBe(0);
    // The site agrees.
    await expect(castVote(voter, s.publicId)).rejects.toMatchObject({ code: "voting_closed" });

    // Move it back to a stage that accepts votes: Discord accepts them again too.
    const back = await statusBySlug("suggestions");
    await moveSuggestion(owner, s.publicId, back.id);
    expect(content(await click(`v:y:${s.publicId}`, voter))).toContain("is in");
  });

  it("follows the owner's own settings for which stages close voting", async () => {
    const owner = await makeUser({ owner: true });
    const planned = await statusBySlug("planned");
    await prisma.status.update({ where: { id: planned.id }, data: { votingOpen: true } });
    const s = await makeApproved(await makeUser());
    await moveSuggestion(owner, s.publicId, planned.id);

    expect(content(await click(`v:y:${s.publicId}`, await makeUser()))).toContain("is in");
  });

  it("keeps the tally when voting closes, but frees the voter's slot", async () => {
    const owner = await makeUser({ owner: true });
    const voter = await makeUser();
    const s = await makeApproved(await makeUser());
    await click(`v:y:${s.publicId}`, voter);

    await moveSuggestion(owner, s.publicId, (await statusBySlug("in-progress")).id);

    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).voteCount).toBe(1);
    expect((await getVoteBudget(voter.id)).remaining).toBe(3);
  });

  it("does not let someone take back a vote once voting is closed, just as on the site", async () => {
    const owner = await makeUser({ owner: true });
    const voter = await makeUser();
    const s = await makeApproved(await makeUser());
    await click(`v:y:${s.publicId}`, voter);
    await moveSuggestion(owner, s.publicId, (await statusBySlug("planned")).id);

    const res = await click(`v:r:${s.publicId}`, voter);

    expect(content(res)).toMatch(/Voting is closed/);
    expect(await prisma.vote.count()).toBe(1);
  });
});

describe("who is allowed to vote from Discord", () => {
  it("creates an account on the first vote for a member who has never visited the site", async () => {
    const s = await makeApproved(await makeUser());
    const who = newcomer();

    const res = await click(`v:y:${s.publicId}`, who);

    expect(content(res)).toContain("is in");
    const account = await prisma.user.findUniqueOrThrow({ where: { discordId: who.discordId } });
    expect(account).toMatchObject({ isMember: true, isOwner: false, blockedAt: null });
    expect(account.displayName).toBe("Global Name");
    expect(await prisma.auditLog.count({ where: { action: "discord.account_created" } })).toBe(1);
  });

  it("uses the server nickname for the name shown on the site", async () => {
    const s = await makeApproved(await makeUser());
    const who = newcomer();
    await signedCall(POST, buttonClick({ customId: `v:y:${s.publicId}`, ...who, nick: "Nick From Server" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { discordId: who.discordId } })).displayName).toBe("Nick From Server");
  });

  it("never makes anyone the owner", async () => {
    const s = await makeApproved(await makeUser());
    await click(`v:y:${s.publicId}`, newcomer());
    expect(await prisma.user.count({ where: { isOwner: true } })).toBe(0);
  });

  it("does not create an account for someone without the Member role", async () => {
    const s = await makeApproved(await makeUser());
    const who = newcomer();

    const res = await click(`v:a:${s.publicId}`, { ...who, roles: [] });

    expect(content(res)).toMatch(/Member role/);
    expect(await prisma.user.count({ where: { discordId: who.discordId } })).toBe(0);
    expect(await prisma.vote.count()).toBe(0);
  });

  it("stops someone who has lost the Member role, using what Discord says now", async () => {
    const s = await makeApproved(await makeUser());
    const lapsed = await makeUser();

    const res = await click(`v:y:${s.publicId}`, { discordId: lapsed.discordId, roles: [] });

    expect(content(res)).toMatch(/Member role/);
    expect(await prisma.vote.count()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: lapsed.id } })).isMember).toBe(false);
  });

  it("stops blocked people", async () => {
    const s = await makeApproved(await makeUser());
    const blocked = await makeUser({ blocked: true });
    const res = await click(`v:y:${s.publicId}`, blocked);
    expect(content(res)).toMatch(/not able to take part/);
    expect(await prisma.vote.count()).toBe(0);
  });

  it("applies the minimum time in the server", async () => {
    await configureSite({ minDaysInServer: 7 });
    const s = await makeApproved(await makeUser());
    const res = await click(`v:a:${s.publicId}`, { ...newcomer(), joinedDaysAgo: 2 });
    expect(content(res)).toMatch(/after \d+ more day/);
    expect(await prisma.vote.count()).toBe(0);
  });

  it("does nothing until the owner has chosen the Member role", async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { memberRoleId: null } });
    const s = await makeApproved(await makeUser());
    const res = await click(`v:a:${s.publicId}`, newcomer());
    expect(content(res)).toMatch(/finished being set up/);
  });

  it("lets the owner vote even without the Member role", async () => {
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    expect(content(await click(`v:y:${s.publicId}`, { discordId: owner.discordId, roles: [] }))).toContain("is in");
  });

  it("stops everything when the board is switched off", async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { discordBoardEnabled: false } });
    const s = await makeApproved(await makeUser());
    const res = await click(`v:y:${s.publicId}`, await makeUser());
    expect(content(res)).toMatch(/switched off/);
    expect(await prisma.vote.count()).toBe(0);
  });
});

describe("hostile input", () => {
  it("ignores buttons that aren't ours or are malformed", async () => {
    const voter = await makeUser();
    for (const customId of ["", "x", "v:a:", "v:a:abcdefgh", "v:z:ABCDEFGH", "v:a:ABCDEFGHI", "v:a:ABCDEFG'", "v:y:../../etc/passwd"]) {
      const res = await click(customId, voter);
      expect(content(res), customId).toMatch(/isn't valid/);
    }
    expect(await prisma.vote.count()).toBe(0);
  });

  it("says a suggestion is unavailable when it doesn't exist or isn't approved", async () => {
    const author = await makeUser();
    const { makePending } = await import("./helpers/db");
    const pending = await makePending(author);
    const voter = await makeUser();
    expect(content(await click(`v:y:ZZZZZZZZ`, voter))).toMatch(/isn't available/);
    expect(content(await click(`v:y:${pending.publicId}`, voter))).toMatch(/isn't available/);
    expect(await prisma.vote.count()).toBe(0);
  });

  it("can only act as the person Discord says clicked, never as someone named in the button", async () => {
    const victim = await makeUser({ name: "Victim" });
    const attacker = await makeUser({ name: "Attacker" });
    const s = await makeApproved(await makeUser());
    await click(`v:y:${s.publicId}`, attacker);
    expect(await prisma.vote.count({ where: { userId: victim.id } })).toBe(0);
    expect(await prisma.vote.count({ where: { userId: attacker.id } })).toBe(1);
  });

  it("never lets a title ping anyone or format the reply", async () => {
    const s = await makeApproved(await makeUser(), "@everyone **free** <@123456789012345678> [click](https://evil.example)");
    const res = await click(`v:a:${s.publicId}`, await makeUser());
    const text = content(res);
    expect(res.json.data.allowed_mentions).toEqual({ parse: [] });
    expect(text).not.toMatch(/@everyone/);
    expect(text).not.toMatch(/\[click\]\(/);
    expect(text).not.toContain("<@1234");
  });

  it("slows down someone who clicks too often", async () => {
    const s = await makeApproved(await makeUser());
    const who = await makeUser();
    let last = "";
    for (let i = 0; i < 25; i++) last = content(await click(`v:a:${s.publicId}`, who));
    expect(last).toMatch(/too quickly/);
  });

  it("keeps the rest of the answer private and without link previews", async () => {
    const s = await makeApproved(await makeUser());
    const res = await click(`v:a:${s.publicId}`, await makeUser());
    expect(res.json.data.flags).toBe(64 | 4);
  });
});

describe("the owner can still be claimed on the site after Discord votes", () => {
  it("leaves ownership unclaimed so the first site sign-in still becomes the owner", async () => {
    const s = await makeApproved(await makeUser());
    await click(`v:y:${s.publicId}`, newcomer());
    expect(await prisma.user.count({ where: { isOwner: true } })).toBe(0);
    discord.add({ id: "400000000000000777", username: "first_owner", roles: [] });
    const { signInWithDiscordId } = await import("@/server/signin");
    const result = await signInWithDiscordId("400000000000000777");
    expect(result).toMatchObject({ ok: true, claimedOwnership: true });
  });
});
