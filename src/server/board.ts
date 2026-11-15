import { Prisma, prisma, type User } from "./db";
import { audit } from "./audit";
import { renderPost, renderRoadmap, suggestedTopic } from "./board-render";
import { DiscordError, createMessage, deleteMessage, editMessage, fetchChannel } from "./discord";
import { toColor } from "./dto";
import { getEnv } from "./env";
import { badRequest, conflict, forbidden } from "./errors";
import { getSettings } from "./settings";
import { interactionsConfigured } from "./signature";

/**
 * The Discord board: approved suggestions posted to a channel with a vote
 * button, and an optional self-updating overview of the stages.
 *
 * One routine, `syncBoard`, makes Discord match the database. Everything that
 * could change what a post shows (a vote, a move to another stage, an edit,
 * a rename) just asks for a sync; it never edits messages itself. That keeps
 * the rules in one place and means a failed edit heals on the next sync.
 *
 *  - A new approval is posted automatically, if it was approved after the
 *    board was switched on. Older suggestions are only posted when the owner
 *    presses "Post all current suggestions".
 *  - Each post shows its stage, and its Vote button is replaced by a disabled
 *    "Voting closed" one in exactly the stages where the site closes voting.
 *  - Posts are only edited when what they show has changed (compared by hash).
 *  - A post someone deletes in Discord is left deleted until the owner asks
 *    for everything to be posted again.
 *
 * It assumes one running copy of the site, as the rest of the app does.
 */

export interface SyncOptions {
  /** Post every suggestion that isn't posted yet, not just new approvals. */
  backfill?: boolean;
  /** With `backfill`: also suggestions in stages where voting is closed. */
  includeClosed?: boolean;
}

export interface BoardRun {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  posted: number;
  updated: number;
  failed: number;
  error: string | null;
}

const run: BoardRun = { running: false, startedAt: null, finishedAt: null, posted: 0, updated: 0, failed: 0, error: null };

/** Pause between messages, to stay well inside Discord's rate limits. Tests turn it off. */
let pauseMs = 400;
/** Timers that fire on their own are off while tests run. */
let timersEnabled = true;

export function configureBoardForTests(options: { pauseMs?: number; timers?: boolean }): void {
  if (options.pauseMs !== undefined) pauseMs = options.pauseMs;
  if (options.timers !== undefined) timersEnabled = options.timers;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

// ── Asking for a sync ────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

/** Syncs shortly from now. Many changes in a row become one sync. Cheap, and does nothing if the board is off. */
export function scheduleBoardSync(delayMs = 3_000): void {
  if (!timersEnabled || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void syncBoard();
  }, delayMs);
  timer.unref();
}

let current: Promise<void> | null = null;
let queued: SyncOptions | null = null;

const merge = (a: SyncOptions | null, b: SyncOptions): SyncOptions => ({
  backfill: Boolean(a?.backfill || b.backfill),
  includeClosed: Boolean(a?.includeClosed || b.includeClosed),
});

/** Runs a sync now. If one is already running, a follow-up is queued and this waits for the current one. */
export function syncBoard(options: SyncOptions = {}): Promise<void> {
  if (current) {
    queued = merge(queued, options);
    return current;
  }
  current = (async () => {
    Object.assign(run, { running: true, startedAt: new Date().toISOString(), finishedAt: null, posted: 0, updated: 0, failed: 0, error: null });
    try {
      let next: SyncOptions | null = options;
      while (next) {
        queued = null;
        await runSync(next);
        next = queued;
      }
    } catch (err) {
      run.error = describeFailure(err);
      // Only the kind of failure; nothing from the message itself.
      console.error("[board] sync stopped:", err instanceof DiscordError ? `Discord ${err.status}` : err instanceof Error ? err.name : "error");
    } finally {
      run.running = false;
      run.finishedAt = new Date().toISOString();
      current = null;
    }
  })();
  return current;
}

// ── The sync itself ──────────────────────────────────────────────────

async function runSync(options: SyncOptions): Promise<void> {
  const settings = await getSettings();
  if (!settings.discordBoardEnabled || !settings.discordChannelId) return;
  const channelId = settings.discordChannelId;
  const origin = getEnv().siteOrigin;

  const toPost: Prisma.SuggestionWhereInput[] = [];
  if (options.backfill) {
    // (An empty condition would not mean "everything" to Prisma, so say it outright.)
    toPost.push(options.includeClosed ? { approval: "APPROVED" } : { status: { votingOpen: true } });
  } else if (settings.discordBoardSince) {
    toPost.push({ discordPostedAt: null, approvedAt: { gte: settings.discordBoardSince }, status: { votingOpen: true } });
  }

  const rows = await prisma.suggestion.findMany({
    where: { approval: "APPROVED", OR: [{ discordMessageId: { not: null } }, ...toPost] },
    include: { author: true, type: true, status: true, tags: { include: { tag: true } } },
    orderBy: [{ approvedAt: "asc" }, { createdAt: "asc" }],
  });

  let failuresInARow = 0;
  for (const row of rows) {
    if (!row.status) continue;
    const { payload, hash } = renderPost({
      publicId: row.publicId,
      title: row.title,
      body: row.body,
      voteCount: row.voteCount,
      authorName: row.author.displayName,
      typeName: row.type?.name ?? null,
      tags: row.tags.map((t) => t.tag).sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.name),
      status: { name: row.status.name, color: toColor(row.status.color), votingOpen: row.status.votingOpen },
      approvedAt: row.approvedAt,
      siteOrigin: origin,
    });

    try {
      if (!row.discordMessageId || !row.discordChannelId) {
        const created = await createMessage(channelId, payload);
        await prisma.suggestion.update({
          where: { id: row.id },
          data: { discordChannelId: channelId, discordMessageId: created.id, discordPostHash: hash, discordPostedAt: row.discordPostedAt ?? new Date() },
        });
        run.posted++;
        await sleep(pauseMs);
      } else if (row.discordPostHash !== hash) {
        await editMessage(row.discordChannelId, row.discordMessageId, payload);
        await prisma.suggestion.update({ where: { id: row.id }, data: { discordPostHash: hash } });
        run.updated++;
        await sleep(pauseMs);
      }
      failuresInARow = 0;
    } catch (err) {
      if (!(err instanceof DiscordError)) throw err;
      if (err.status === 404 && row.discordMessageId) {
        // Someone deleted the post in Discord. Leave it deleted (discordPostedAt stays set).
        await prisma.suggestion.update({
          where: { id: row.id },
          data: { discordChannelId: null, discordMessageId: null, discordPostHash: null },
        });
        continue;
      }
      // A network problem or Discord being down will not get better by trying the next one.
      if (err.status === 0 || err.status >= 500) throw err;
      run.failed++;
      run.error = describeFailure(err);
      if (++failuresInARow >= 3) throw err;
    }
  }

  await syncRoadmap(settings, origin);
}

async function syncRoadmap(settings: Awaited<ReturnType<typeof getSettings>>, origin: string): Promise<void> {
  const channelId = settings.discordRoadmapChannelId;
  if (!channelId) return;

  const statuses = await prisma.status.findMany({ where: { showOnRoadmap: true }, orderBy: { sortOrder: "asc" } });
  const columns = await Promise.all(
    statuses.map(async (status) => {
      const where = { approval: "APPROVED", statusId: status.id } as const;
      const [total, items] = await Promise.all([
        prisma.suggestion.count({ where }),
        prisma.suggestion.findMany({
          where,
          orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
          take: 12,
          select: { publicId: true, title: true, voteCount: true },
        }),
      ]);
      return { status: { name: status.name, color: toColor(status.color) }, total, items };
    }),
  );

  const { payload, hash } = renderRoadmap({ siteOrigin: origin, boardChannelId: settings.discordChannelId, columns });
  if (settings.discordRoadmapMessageId && settings.discordRoadmapHash === hash) return;

  if (settings.discordRoadmapMessageId) {
    try {
      await editMessage(channelId, settings.discordRoadmapMessageId, payload);
      await prisma.settings.update({ where: { id: 1 }, data: { discordRoadmapHash: hash } });
      run.updated++;
      return;
    } catch (err) {
      if (!(err instanceof DiscordError) || err.status !== 404) throw err;
      // Deleted in Discord: post a fresh one below.
    }
  }
  const created = await createMessage(channelId, payload);
  await prisma.settings.update({ where: { id: 1 }, data: { discordRoadmapMessageId: created.id, discordRoadmapHash: hash } });
  run.posted++;
}

/** Deletes a post whose suggestion has been removed. Best effort: a message that is already gone is fine. */
export async function removePost(channelId: string | null, messageId: string | null): Promise<void> {
  if (!channelId || !messageId) return;
  try {
    await deleteMessage(channelId, messageId);
  } catch {
    // The suggestion is gone either way. A leftover message is only cosmetic.
  }
}

// ── Owner-facing ─────────────────────────────────────────────────────

function assertOwner(actor: User): void {
  if (!actor.isOwner) throw forbidden();
}

/** Plain-language reasons, for the owner setting this up. */
export function describeFailure(err: unknown): string {
  if (err instanceof DiscordError) {
    if (err.status === 401) return "Discord rejected the bot's token. Check DISCORD_BOT_TOKEN.";
    if (err.status === 403) return "The bot isn't allowed to post there. In the channel's permissions, allow View Channel, Send Messages and Embed Links for the bot.";
    if (err.status === 404) return "Discord couldn't find that channel. Check the ID, and that the bot can see it.";
    if (err.status === 0) return "Discord couldn't be reached. It will be tried again shortly.";
    return `Discord answered with an error (${err.status}).`;
  }
  return "Something went wrong while posting. It will be tried again shortly.";
}

/**
 * Checks a channel before it is saved: it is in this server, it is a text
 * channel, and the bot can post embeds there. Posts a short message and
 * deletes it again.
 */
async function verifyChannel(channelId: string): Promise<void> {
  let channel;
  try {
    channel = await fetchChannel(channelId);
  } catch (err) {
    throw badRequest(describeFailure(err), "channel_unreachable");
  }
  if (channel.guildId !== getEnv().DISCORD_GUILD_ID) throw badRequest("That channel isn't in your Discord server.", "wrong_server");
  if (channel.type !== 0 && channel.type !== 5) throw badRequest("Pick a text channel.", "not_text_channel");

  let created;
  try {
    created = await createMessage(channelId, {
      content: "Checking that the bot can post here. This message deletes itself.",
      embeds: [{ description: "Checking that embeds work." }],
      allowed_mentions: { parse: [] },
    });
  } catch (err) {
    throw badRequest(describeFailure(err), "cannot_post");
  }
  await deleteMessage(channelId, created.id).catch(() => undefined);
  if (created.embedCount === 0) {
    throw badRequest("The bot can post there but isn't allowed to show embeds. Allow Embed Links for the bot in that channel.", "no_embeds");
  }
}

export interface BoardConfigInput {
  enabled: boolean;
  /** Empty string clears it. */
  channelId: string;
  roadmapChannelId: string;
}

export async function configureBoard(actor: User, input: BoardConfigInput, request?: Request): Promise<void> {
  assertOwner(actor);
  const settings = await getSettings();
  const channelId = input.channelId || null;
  const roadmapChannelId = input.roadmapChannelId || null;

  if (input.enabled && !channelId) throw badRequest("Choose the channel to post suggestions in.", "channel_required");
  if (input.enabled && !interactionsConfigured()) {
    throw conflict("not_configured", "Add DISCORD_PUBLIC_KEY to the server's .env first, so the vote buttons can work.");
  }
  if (channelId && channelId !== settings.discordChannelId) await verifyChannel(channelId);
  if (roadmapChannelId && roadmapChannelId !== settings.discordRoadmapChannelId) await verifyChannel(roadmapChannelId);

  // Moving or removing the overview: tidy the old message up.
  const roadmapMoved = roadmapChannelId !== settings.discordRoadmapChannelId;
  if (roadmapMoved) await removePost(settings.discordRoadmapChannelId, settings.discordRoadmapMessageId);

  await prisma.settings.update({
    where: { id: 1 },
    data: {
      discordBoardEnabled: input.enabled,
      discordChannelId: channelId,
      discordRoadmapChannelId: roadmapChannelId,
      ...(roadmapMoved ? { discordRoadmapMessageId: null, discordRoadmapHash: null } : {}),
      // Only suggestions approved from now on are posted on their own.
      ...(input.enabled && !settings.discordBoardEnabled ? { discordBoardSince: new Date() } : {}),
    },
  });
  await audit({
    action: "discord_board.configure",
    actor,
    targetType: "settings",
    details: { enabled: input.enabled, channel: channelId, roadmapChannel: roadmapChannelId },
    request,
  });
  scheduleBoardSync(0);
}

export async function startBackfill(actor: User, options: { includeClosed: boolean }, request?: Request): Promise<void> {
  assertOwner(actor);
  const settings = await getSettings();
  if (!settings.discordBoardEnabled || !settings.discordChannelId) {
    throw conflict("board_off", "Switch the Discord board on and choose a channel first.");
  }
  if (run.running) throw conflict("already_running", "Posting is already in progress.");
  await audit({ action: "discord_board.post_all", actor, targetType: "settings", details: { includeClosed: options.includeClosed }, request });
  // Not awaited: a long list takes a while. Progress is shown by `boardOverview`.
  void syncBoard({ backfill: true, includeClosed: options.includeClosed });
}

export interface BoardOverview {
  enabled: boolean;
  channelId: string | null;
  roadmapChannelId: string | null;
  publicKeyConfigured: boolean;
  interactionsUrl: string;
  /** A line for the channel's topic that says where ideas are sent. */
  suggestedTopic: string;
  /** Approved suggestions that are open for voting. */
  openCount: number;
  /** Suggestions that currently have a post. */
  postedCount: number;
  run: BoardRun;
}

export async function boardOverview(actor: User): Promise<BoardOverview> {
  assertOwner(actor);
  const settings = await getSettings();
  const [openCount, postedCount] = await Promise.all([
    prisma.suggestion.count({ where: { approval: "APPROVED", status: { votingOpen: true } } }),
    prisma.suggestion.count({ where: { discordMessageId: { not: null } } }),
  ]);
  return {
    enabled: settings.discordBoardEnabled,
    channelId: settings.discordChannelId,
    roadmapChannelId: settings.discordRoadmapChannelId,
    publicKeyConfigured: interactionsConfigured(),
    interactionsUrl: `${getEnv().siteOrigin}/api/discord/interactions`,
    suggestedTopic: suggestedTopic(getEnv().siteOrigin),
    openCount,
    postedCount,
    run: { ...run },
  };
}
