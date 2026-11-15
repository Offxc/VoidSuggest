import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { boardOverview, configureBoard, configureBoardForTests, startBackfill, syncBoard } from "@/server/board";
import { renderPost, renderRoadmap, suggestedTopic, voteButtonId, type PostInput } from "@/server/board-render";
import { prisma } from "@/server/db";
import { deleteSuggestion, moveSuggestion, updateSuggestion } from "@/server/suggestions";
import { castVote, strikeVote } from "@/server/votes";
import { configureSite, makeApproved, makePending, makeUser, resetDb, statusBySlug } from "./helpers/db";
import { removeInteractionKey, useInteractionKey } from "./helpers/interactions";
import { MockDiscord } from "./helpers/mock-discord";

/**
 * The Discord board: what gets posted, how posts follow the site, and what
 * people can and can't make a post say. Discord is played by a local stand-in.
 */

const discord = new MockDiscord();
const CHANNEL = "900000000000000001";
const ROADMAP = "900000000000000002";

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
  await configureSite({ voteSlots: 3 });
  discord.messages.clear();
  discord.channels.clear();
  discord.addChannel(CHANNEL);
  discord.addChannel(ROADMAP);
  discord.failWith = null;
  discord.postFailsWith = null;
  discord.requests.length = 0;
});

async function enableBoard(patch: Record<string, unknown> = {}) {
  await prisma.settings.update({
    where: { id: 1 },
    data: { discordBoardEnabled: true, discordChannelId: CHANNEL, discordBoardSince: new Date(Date.now() - 5_000), ...patch },
  });
}

/** An approved suggestion from before the board was switched on. */
async function makeOld(author: Awaited<ReturnType<typeof makeUser>>, title: string, statusSlug = "suggestions") {
  const s = await makeApproved(author, title, statusSlug);
  return prisma.suggestion.update({ where: { id: s.id }, data: { approvedAt: new Date(Date.now() - 86_400_000) } });
}

const post = (index = 0) => discord.inChannel(CHANNEL)[index]!.payload;
const embed = (index = 0) => post(index).embeds[0];
const field = (name: string, index = 0) => embed(index).fields.find((f: { name: string }) => f.name === name)?.value as string;
const voteButton = (index = 0) => post(index).components[0].components[0];

describe("posting", () => {
  it("posts a new approval with its stage, votes and a vote button", async () => {
    await enableBoard();
    const author = await makeUser({ name: "Alex the Miner" });
    const s = await makeApproved(author, "Bigger villager trading halls");

    await syncBoard();

    expect(discord.inChannel(CHANNEL)).toHaveLength(1);
    expect(embed().title).toBe("Bigger villager trading halls");
    expect(embed().url).toBe(`https://suggest.test/s/${s.publicId}`);
    expect(field("Stage")).toContain("Suggestions");
    expect(field("Votes")).toBe("0");
    expect(embed().footer.text).toContain("Alex the Miner");
    expect(voteButton()).toMatchObject({ label: "Vote", custom_id: voteButtonId(s.publicId) });
    expect(voteButton().disabled).toBeUndefined();
    expect(post().allowed_mentions).toEqual({ parse: [] });

    const saved = await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } });
    expect(saved).toMatchObject({ discordChannelId: CHANNEL });
    expect(saved.discordMessageId).toBeTruthy();
    expect(saved.discordPostedAt).toBeTruthy();
  });

  it("does nothing while the board is off", async () => {
    await makeApproved(await makeUser());
    await syncBoard();
    expect(discord.messages.size).toBe(0);
  });

  it("does not post pending or rejected suggestions", async () => {
    await enableBoard();
    await makePending(await makeUser());
    await syncBoard();
    expect(discord.messages.size).toBe(0);
  });

  it("posts only suggestions approved after the board was switched on, until asked to post the rest", async () => {
    const author = await makeUser();
    await makeOld(author, "Approved long before the board existed");
    await enableBoard();
    await makeApproved(author, "Approved after the board was switched on");

    await syncBoard();
    expect(discord.inChannel(CHANNEL).map((m) => m.payload.embeds[0].title)).toEqual(["Approved after the board was switched on"]);

    await syncBoard({ backfill: true });
    expect(discord.inChannel(CHANNEL)).toHaveLength(2);
  });

  it("posting everything is safe to repeat and keeps the oldest first", async () => {
    const author = await makeUser();
    const first = await makeOld(author, "The oldest suggestion on the board");
    await prisma.suggestion.update({ where: { id: first.id }, data: { approvedAt: new Date(Date.now() - 3 * 86_400_000) } });
    await makeOld(author, "A somewhat newer suggestion here");
    await enableBoard();

    await syncBoard({ backfill: true });
    await syncBoard({ backfill: true });

    const titles = discord.inChannel(CHANNEL).map((m) => m.payload.embeds[0].title);
    expect(titles).toEqual(["The oldest suggestion on the board", "A somewhat newer suggestion here"]);
  });

  it("leaves out suggestions where voting is closed unless asked, then posts them locked", async () => {
    const author = await makeUser();
    await makeOld(author, "Still open for voting here");
    await makeOld(author, "Already planned by the team", "planned");
    await enableBoard();

    await syncBoard({ backfill: true });
    expect(discord.inChannel(CHANNEL)).toHaveLength(1);

    await syncBoard({ backfill: true, includeClosed: true });
    expect(discord.inChannel(CHANNEL)).toHaveLength(2);
    const planned = discord.inChannel(CHANNEL).find((m) => m.payload.embeds[0].title.startsWith("Already planned"))!;
    expect(planned.payload.embeds[0].fields[0].value).toContain("Planned");
    expect(planned.payload.components[0].components[0]).toMatchObject({ label: "Voting closed", disabled: true });
  });

  it("shows progress to the owner while posting everything", async () => {
    const owner = await makeUser({ owner: true });
    await makeOld(await makeUser(), "One suggestion that needs posting");
    await enableBoard();

    await startBackfill(owner, { includeClosed: false });
    await syncBoard();
    const overview = await boardOverview(owner);

    expect(overview).toMatchObject({ enabled: true, openCount: 1, postedCount: 1, publicKeyConfigured: true });
    expect(overview.run).toMatchObject({ running: false, posted: 1, error: null });
    expect(overview.interactionsUrl).toBe("https://suggest.test/api/discord/interactions");
  });
});

describe("posts follow the site", () => {
  it("updates the vote count when people vote, and only when something changed", async () => {
    await enableBoard();
    const s = await makeApproved(await makeUser());
    await syncBoard();
    expect(field("Votes")).toBe("0");

    await castVote(await makeUser(), s.publicId);
    await castVote(await makeUser(), s.publicId);
    await syncBoard();
    expect(field("Votes")).toBe("2");

    discord.requests.length = 0;
    await syncBoard();
    expect(discord.writes()).toBe(0);
  });

  it("updates when the owner strikes a vote", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const voter = await makeUser();
    const s = await makeApproved(await makeUser());
    await castVote(voter, s.publicId);
    await syncBoard();
    expect(field("Votes")).toBe("1");

    await strikeVote(owner, s.publicId, voter.id);
    await syncBoard();
    expect(field("Votes")).toBe("0");
  });

  it("shows the new stage and locks voting when the owner moves it, and unlocks it when moved back", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    await syncBoard();

    await moveSuggestion(owner, s.publicId, (await statusBySlug("planned")).id);
    await syncBoard();
    expect(field("Stage")).toContain("Planned");
    expect(voteButton()).toMatchObject({ label: "Voting closed", disabled: true });
    expect(embed().color).not.toBe(0x8164e3);

    await moveSuggestion(owner, s.publicId, (await statusBySlug("suggestions")).id);
    await syncBoard();
    expect(field("Stage")).toContain("Suggestions");
    expect(voteButton()).toMatchObject({ label: "Vote" });
    expect(voteButton().disabled).toBeUndefined();
  });

  it("locks exactly the stages the owner has set to close voting", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const inProgress = await statusBySlug("in-progress");
    await prisma.status.update({ where: { id: inProgress.id }, data: { votingOpen: true } });
    const s = await makeApproved(await makeUser());
    await syncBoard();

    await moveSuggestion(owner, s.publicId, inProgress.id);
    await syncBoard();

    expect(field("Stage")).toContain("In Progress");
    expect(voteButton()).toMatchObject({ label: "Vote" });
  });

  it("follows a renamed stage", async () => {
    await enableBoard();
    const s = await makeApproved(await makeUser());
    await syncBoard();
    await prisma.status.update({ where: { id: s.statusId! }, data: { name: "Open for votes" } });
    await syncBoard();
    expect(field("Stage")).toContain("Open for votes");
  });

  it("takes the post down when the suggestion is deleted", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    await syncBoard();
    expect(discord.messages.size).toBe(1);

    await deleteSuggestion(owner, s.publicId);

    await vi.waitFor(() => expect(discord.messages.size).toBe(0));
  });

  it("leaves a post deleted in Discord deleted, until everything is posted again", async () => {
    await enableBoard();
    const s = await makeApproved(await makeUser());
    await syncBoard();
    discord.messages.clear();

    await castVote(await makeUser(), s.publicId);
    await syncBoard();
    expect(discord.messages.size).toBe(0);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).discordMessageId).toBeNull();

    await syncBoard();
    expect(discord.messages.size).toBe(0);

    await syncBoard({ backfill: true });
    expect(discord.messages.size).toBe(1);
  });

  it("keeps a post where it was if the channel setting changes later", async () => {
    await enableBoard();
    const s = await makeApproved(await makeUser());
    await syncBoard();
    const other = "900000000000000009";
    discord.addChannel(other);
    await prisma.settings.update({ where: { id: 1 }, data: { discordChannelId: other } });

    await castVote(await makeUser(), s.publicId);
    await syncBoard();

    expect(discord.inChannel(CHANNEL)).toHaveLength(1);
    expect(discord.inChannel(other)).toHaveLength(0);
    expect(field("Votes")).toBe("1");
  });
});

describe("what makes a new message", () => {
  it("is only a new suggestion; everything else changes the post that is already there", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    const a = await makeApproved(author, "The first of two new suggestions");
    const b = await makeApproved(author, "The second of two new suggestions");
    await syncBoard();
    expect(discord.messages.size).toBe(2);
    const created = () => discord.requests.filter((r) => r.method === "POST" && r.url.endsWith("/messages")).length;
    const before = created();

    // Votes, a strike, moves between stages, a rename, an owner edit, a tag, and plenty of repeat syncs.
    const voter = await makeUser();
    await castVote(voter, a.publicId);
    await castVote(await makeUser(), b.publicId);
    await syncBoard();
    await strikeVote(owner, a.publicId, voter.id);
    await moveSuggestion(owner, a.publicId, (await statusBySlug("planned")).id);
    await syncBoard();
    await moveSuggestion(owner, a.publicId, (await statusBySlug("completed")).id);
    await moveSuggestion(owner, b.publicId, (await statusBySlug("in-progress")).id);
    await prisma.status.update({ where: { id: (await statusBySlug("in-progress")).id }, data: { name: "Being built" } });
    await updateSuggestion(owner, b.publicId, { title: "The second suggestion, reworded" });
    await moveSuggestion(owner, b.publicId, (await statusBySlug("suggestions")).id);
    for (let i = 0; i < 3; i++) await syncBoard();

    expect(created()).toBe(before);
    expect(discord.messages.size).toBe(2);
    expect(discord.requests.some((r) => r.method === "PATCH")).toBe(true);
    expect(discord.inChannel(CHANNEL).map((m) => m.payload.embeds[0].title).sort()).toEqual([
      "The first of two new suggestions",
      "The second suggestion, reworded",
    ]);

    // And a genuinely new suggestion is the one thing that adds a message.
    await makeApproved(author, "A third and genuinely new suggestion");
    await syncBoard();
    expect(created()).toBe(before + 1);
    expect(discord.messages.size).toBe(3);
  });

  it("does not post again for a suggestion that went away and came back to an open stage", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    await syncBoard();
    for (const slug of ["planned", "suggestions", "declined", "suggestions"]) {
      await moveSuggestion(owner, s.publicId, (await statusBySlug(slug)).id);
      await syncBoard();
    }
    expect(discord.messages.size).toBe(1);
  });
});

describe("telling people where to send ideas", () => {
  it("puts a Suggest an idea button on every post, open or closed, pointing at the form", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    await syncBoard();
    const labelled = () =>
      post().components[0].components.filter((c: { url?: string }) => c.url).map((c: { label: string; url: string }) => [c.label, c.url]);
    expect(labelled()).toEqual([
      ["View on site", `https://suggest.test/s/${s.publicId}`],
      ["Suggest an idea", "https://suggest.test/new"],
    ]);

    await moveSuggestion(owner, s.publicId, (await statusBySlug("completed")).id);
    await syncBoard();
    expect(labelled().map(([label]: [string, string]) => label)).toContain("Suggest an idea");
  });

  it("says it in the stages overview too, without a link preview", async () => {
    await enableBoard({ discordRoadmapChannelId: ROADMAP });
    await makeApproved(await makeUser(), "Something that is on the roadmap", "planned");
    await syncBoard();
    const overview = discord.inChannel(ROADMAP)[0]!.payload;
    expect(overview.content).toContain("Got an idea? Suggest it at <https://suggest.test/new>");
    expect(overview.components[0].components.map((c: { label: string }) => c.label)).toEqual(["Open the roadmap", "Suggest an idea"]);
  });

  it("gives the owner a line to paste into the channel topic, and shows it on the setup page's data", async () => {
    expect(suggestedTopic("https://suggest.example.com")).toBe("Suggest an idea at suggest.example.com. Vote with the button under each post.");
    const owner = await makeUser({ owner: true });
    expect((await boardOverview(owner)).suggestedTopic).toBe("Suggest an idea at suggest.test. Vote with the button under each post.");
  });
});

describe("when Discord misbehaves", () => {
  it("explains a missing permission, stops after repeated refusals, and recovers once it is fixed", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    for (const n of [1, 2, 3, 4]) await makeApproved(author, `Idea ${n} that cannot be posted yet`);
    discord.channels.get(CHANNEL)!.canPost = false;

    await syncBoard();

    expect(discord.messages.size).toBe(0);
    const stuck = await boardOverview(owner);
    expect(stuck.run.error).toMatch(/Send Messages/);
    expect(stuck.run.failed).toBeGreaterThanOrEqual(3);
    expect(discord.requests.filter((r) => r.method === "POST").length).toBe(3);

    discord.channels.get(CHANNEL)!.canPost = true;
    await syncBoard();
    expect(discord.messages.size).toBe(4);
    expect((await boardOverview(owner)).run.error).toBeNull();
  });

  it("stops at once when Discord is down, records nothing as posted, and catches up later", async () => {
    await enableBoard();
    const owner = await makeUser({ owner: true });
    const author = await makeUser();
    await makeApproved(author, "First idea while Discord is down");
    await makeApproved(author, "Second idea while Discord is down");
    discord.postFailsWith = 503;

    await syncBoard();

    expect(discord.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(await prisma.suggestion.count({ where: { discordMessageId: { not: null } } })).toBe(0);
    expect((await boardOverview(owner)).run.error).toMatch(/Discord/);

    discord.postFailsWith = null;
    await syncBoard();
    expect(discord.messages.size).toBe(2);
  });

  it("does not let one failing sync block the next one", async () => {
    await enableBoard();
    await makeApproved(await makeUser(), "An idea to post despite an earlier failure");
    discord.failWith = 500;
    await syncBoard();
    discord.failWith = null;
    await syncBoard();
    expect(discord.messages.size).toBe(1);
  });
});

describe("the stages overview", () => {
  it("posts one message listing each stage, and keeps it up to date", async () => {
    const owner = await makeUser({ owner: true });
    await enableBoard({ discordRoadmapChannelId: ROADMAP });
    const author = await makeUser();
    const a = await makeApproved(author, "Planned thing everyone wants", "planned");
    await makeApproved(author, "Being built right now by us", "in-progress");
    await castVote(await makeUser(), a.publicId).catch(() => undefined);

    await syncBoard();

    const messages = discord.inChannel(ROADMAP);
    expect(messages).toHaveLength(1);
    const overview = messages[0]!.payload;
    expect(overview.content).toContain(`<#${CHANNEL}>`);
    const stages = overview.embeds.map((e: { title: string }) => e.title);
    expect(stages.some((t: string) => t.includes("Planned") && t.endsWith("· 1"))).toBe(true);
    expect(stages.some((t: string) => t.includes("In Progress"))).toBe(true);
    expect(stages.some((t: string) => t.includes("Completed") && t.endsWith("· 0"))).toBe(true);
    expect(overview.embeds[0].description).toContain("Planned thing everyone wants");
    expect(overview.allowed_mentions).toEqual({ parse: [] });

    const s = await prisma.suggestion.findFirstOrThrow({ where: { title: "Being built right now by us" } });
    await moveSuggestion(owner, s.publicId, (await statusBySlug("completed")).id);
    await syncBoard();

    expect(discord.inChannel(ROADMAP)).toHaveLength(1);
    const after = discord.inChannel(ROADMAP)[0]!.payload.embeds;
    expect(after.find((e: { title: string }) => e.title.includes("Completed")).description).toContain("Being built right now by us");
    expect(after.find((e: { title: string }) => e.title.includes("In Progress")).description).toContain("Nothing here yet");
  });

  it("is only edited when it changes", async () => {
    await enableBoard({ discordRoadmapChannelId: ROADMAP });
    await makeApproved(await makeUser(), "Something that is on the roadmap", "planned");
    await syncBoard();
    discord.requests.length = 0;
    await syncBoard();
    expect(discord.writes()).toBe(0);
  });

  it("is posted again if someone deletes it", async () => {
    await enableBoard({ discordRoadmapChannelId: ROADMAP });
    await makeApproved(await makeUser(), "Something that is on the roadmap", "planned");
    await syncBoard();
    discord.messages.clear();
    await makeApproved(await makeUser(), "Another thing on the roadmap too", "planned");
    await syncBoard();
    expect(discord.inChannel(ROADMAP)).toHaveLength(1);
  });

  it("is left alone when no channel is chosen for it", async () => {
    await enableBoard();
    await makeApproved(await makeUser(), "Something that is on the roadmap", "planned");
    await syncBoard();
    expect(discord.inChannel(ROADMAP)).toHaveLength(0);
  });
});

describe("setting it up", () => {
  const input = { enabled: true, channelId: CHANNEL, roadmapChannelId: "" };

  it("saves a channel the bot can post in, tidies up its test message, and starts from now", async () => {
    const owner = await makeUser({ owner: true });
    await makeOld(await makeUser(), "Approved before the board");

    await configureBoard(owner, input);

    expect(discord.messages.size).toBe(0);
    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings).toMatchObject({ discordBoardEnabled: true, discordChannelId: CHANNEL });
    expect(settings.discordBoardSince!.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it("refuses to switch on without the application's public key, because the buttons could not work", async () => {
    removeInteractionKey();
    try {
      await expect(configureBoard(await makeUser({ owner: true }), input)).rejects.toMatchObject({ status: 409, code: "not_configured" });
    } finally {
      useInteractionKey();
    }
  });

  it("refuses a channel that doesn't exist, is in another server, or isn't a text channel", async () => {
    const owner = await makeUser({ owner: true });
    discord.addChannel("900000000000000003", { guildId: "200000000000000999" });
    discord.addChannel("900000000000000004", { type: 2 });
    await expect(configureBoard(owner, { ...input, channelId: "900000000000000099" })).rejects.toMatchObject({ code: "channel_unreachable" });
    await expect(configureBoard(owner, { ...input, channelId: "900000000000000003" })).rejects.toMatchObject({ code: "wrong_server" });
    await expect(configureBoard(owner, { ...input, channelId: "900000000000000004" })).rejects.toMatchObject({ code: "not_text_channel" });
    expect((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).discordBoardEnabled).toBe(false);
  });

  it("tells the owner exactly what permission is missing", async () => {
    const owner = await makeUser({ owner: true });
    discord.channels.get(CHANNEL)!.canPost = false;
    await expect(configureBoard(owner, input)).rejects.toMatchObject({ code: "cannot_post", message: expect.stringMatching(/Send Messages/) });

    discord.channels.get(CHANNEL)!.canPost = true;
    discord.channels.get(CHANNEL)!.canEmbed = false;
    await expect(configureBoard(owner, input)).rejects.toMatchObject({ code: "no_embeds", message: expect.stringMatching(/Embed Links/) });
    expect(discord.messages.size).toBe(0);
  });

  it("needs a channel before it can be switched on", async () => {
    await expect(configureBoard(await makeUser({ owner: true }), { ...input, channelId: "" })).rejects.toMatchObject({ code: "channel_required" });
  });

  it("is for the owner only", async () => {
    const member = await makeUser();
    await expect(configureBoard(member, input)).rejects.toMatchObject({ status: 403 });
    await expect(startBackfill(member, { includeClosed: false })).rejects.toMatchObject({ status: 403 });
    await expect(boardOverview(member)).rejects.toMatchObject({ status: 403 });
  });

  it("won't post everything while the board is off", async () => {
    await expect(startBackfill(await makeUser({ owner: true }), { includeClosed: false })).rejects.toMatchObject({ code: "board_off" });
  });

  it("removes the old overview when its channel changes", async () => {
    const owner = await makeUser({ owner: true });
    await configureBoard(owner, { ...input, roadmapChannelId: ROADMAP });
    await makeApproved(await makeUser(), "Something that is on the roadmap", "planned");
    await syncBoard();
    expect(discord.inChannel(ROADMAP)).toHaveLength(1);

    await configureBoard(owner, { ...input, roadmapChannelId: "" });
    expect(discord.inChannel(ROADMAP)).toHaveLength(0);
    expect((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).discordRoadmapMessageId).toBeNull();
  });
});

describe("the database refuses a post that doesn't make sense", () => {
  it("keeps channel and message together, and only on approved suggestions", async () => {
    const author = await makeUser();
    const approved = await makeApproved(author);
    const pending = await makePending(author);
    await expect(prisma.suggestion.update({ where: { id: approved.id }, data: { discordMessageId: "700000000000000001" } })).rejects.toThrow();
    await expect(
      prisma.suggestion.update({ where: { id: pending.id }, data: { discordChannelId: CHANNEL, discordMessageId: "700000000000000001" } }),
    ).rejects.toThrow();
    await expect(
      prisma.suggestion.update({ where: { id: approved.id }, data: { discordChannelId: "../etc", discordMessageId: "700000000000000001" } }),
    ).rejects.toThrow();
    await expect(prisma.settings.update({ where: { id: 1 }, data: { discordChannelId: "not-a-channel" } })).rejects.toThrow();
  });
});

describe("what a post can contain", () => {
  const base: PostInput = {
    publicId: "ABCDEFGH",
    title: "A perfectly reasonable idea",
    body: "This is a long enough description to pass validation easily.",
    voteCount: 3,
    authorName: "Alex",
    typeName: "Feature request",
    tags: ["Economy"],
    status: { name: "Suggestions", color: "purple", votingOpen: true },
    approvedAt: new Date("2026-01-01T00:00:00Z"),
    siteOrigin: "https://suggest.test",
  };

  it("never pings anyone or turns text into formatting or a link", () => {
    const { payload } = renderPost({
      ...base,
      title: "@everyone <@123456789012345678> <#123456789012345678> `code`",
      body: "Click [here](https://evil.example/phish) now @here **bold** __under__ ||spoiler|| > quote\n# heading",
      authorName: "@everyone",
      typeName: "[Type](https://evil.example)",
      tags: ["@here", "<@123456789012345678>"],
      status: { name: "[Stage](https://evil.example)", color: "blue", votingOpen: true },
    });
    const embed = (payload.embeds as any[])[0];
    const all = JSON.stringify(embed);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(all).not.toMatch(/@everyone|@here/);
    expect(all).not.toMatch(/<@\d|<#\d/);
    expect(embed.description).not.toMatch(/\]\(/);
    expect(embed.fields.map((f: { value: string }) => f.value).join(" ")).not.toMatch(/\]\(/);
    // The only links are the ones we chose.
    expect(embed.url).toBe("https://suggest.test/s/ABCDEFGH");
    const buttons = (payload.components as any[])[0].components;
    expect(buttons.filter((b: { url?: string }) => b.url).map((b: { url: string }) => b.url)).toEqual([
      "https://suggest.test/s/ABCDEFGH",
      "https://suggest.test/new",
    ]);
  });

  it("stays inside Discord's limits however much is typed", () => {
    const { payload } = renderPost({
      ...base,
      title: "T".repeat(120),
      body: "word ".repeat(1000),
      authorName: "N".repeat(64),
      tags: ["x".repeat(32), "y".repeat(32), "z".repeat(32), "w".repeat(32), "v".repeat(32)],
      typeName: "Q".repeat(40),
    });
    const embed = (payload.embeds as any[])[0];
    expect(embed.title.length).toBeLessThanOrEqual(256);
    expect(embed.description.length).toBeLessThanOrEqual(4096);
    expect(embed.footer.text.length).toBeLessThanOrEqual(2048);
    expect(embed.fields.length).toBeLessThanOrEqual(25);
    for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(embed).length).toBeLessThan(6000);
  });

  it("gives the vote button an id the interactions handler understands, and only while voting is open", () => {
    const open = renderPost(base).payload.components as any[];
    const closed = renderPost({ ...base, status: { name: "Planned", color: "blue", votingOpen: false } }).payload.components as any[];
    expect(open[0].components[0].custom_id).toMatch(/^v:a:[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(open[0].components[0].disabled).toBeUndefined();
    expect(closed[0].components[0].disabled).toBe(true);
  });

  it("changes its fingerprint exactly when what people see changes", () => {
    const a = renderPost(base).hash;
    expect(renderPost({ ...base }).hash).toBe(a);
    expect(renderPost({ ...base, voteCount: 4 }).hash).not.toBe(a);
    expect(renderPost({ ...base, status: { ...base.status, name: "Open" } }).hash).not.toBe(a);
    expect(renderPost({ ...base, status: { ...base.status, votingOpen: false } }).hash).not.toBe(a);
    expect(renderPost({ ...base, title: "A different title entirely" }).hash).not.toBe(a);
  });

  it("keeps the overview within limits and never lets a title break out of its link", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ publicId: `ABCDEFG${i % 10}`, title: `Item ${i} ] (https://evil.example) @everyone ${"x".repeat(100)}`, voteCount: i }));
    const { payload } = renderRoadmap({
      siteOrigin: "https://suggest.test",
      boardChannelId: CHANNEL,
      columns: Array.from({ length: 12 }, (_, i) => ({ status: { name: `Stage ${i}`, color: "teal" as const }, total: 30, items })),
    });
    const embeds = payload.embeds as any[];
    expect(embeds.length).toBeLessThanOrEqual(10);
    for (const e of embeds) {
      expect(e.description.length).toBeLessThanOrEqual(4096);
      expect(e.description).not.toMatch(/@everyone/);
      expect(e.description).not.toMatch(/\]\(https:\/\/evil/);
    }
    expect(embeds[0].description).toMatch(/and \d+ more on the site/);
    // Discord counts the text of every embed in a message together, and refuses more than 6000.
    const total = embeds.reduce((sum: number, e: { title: string; description: string }) => sum + e.title.length + e.description.length, 0);
    expect(total).toBeLessThanOrEqual(6000);
  });
});
