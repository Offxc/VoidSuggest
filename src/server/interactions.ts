import { z } from "zod";
import { Prisma, prisma, type Settings, type User } from "./db";
import { audit } from "./audit";
import { formatted } from "./board-render";
import { parseMember, type GuildMember } from "./discord";
import { participationBlock } from "./eligibility";
import { getEnv } from "./env";
import { HttpError } from "./errors";
import { applyMembership, holdsMemberRole, identityColumns } from "./identity";
import { rateLimit } from "./rate-limit";
import { getSettings } from "./settings";
import { castVote, getVoteBudget, retractVote, type VoteBudget } from "./votes";

/**
 * What happens when someone clicks a button on a Discord post.
 *
 * Discord sends the click to the site, signed (see `signature.ts`). The
 * request says who clicked and which roles they hold in the server, and
 * because it is signed that can be believed. That person is matched to the
 * same account the site uses, by Discord ID, so a vote cast in Discord and a
 * vote cast on the site draw on the same pool of vote slots and are counted
 * together. Someone who has never visited the site gets an account the first
 * time they vote, if they hold the Member role.
 *
 * Voting always takes two clicks. The Vote button on the post answers, only
 * to the person who clicked, with how many votes they have left and a Confirm
 * button. Confirming does the vote, through the same code the site uses, so
 * every rule (slots, stages where voting is closed, blocked people, the
 * minimum time in the server) applies here exactly as it does there.
 */

const snowflake = z.string().regex(/^\d{5,25}$/);

export const interactionSchema = z.object({
  id: snowflake,
  application_id: snowflake,
  type: z.number().int(),
  guild_id: snowflake.optional(),
  member: z.unknown().optional(),
  data: z.object({ custom_id: z.string().max(100).optional() }).optional(),
});
export type Interaction = z.infer<typeof interactionSchema>;

const PING = 1;
const MESSAGE_COMPONENT = 3;
const PONG = 1;
const REPLY = 4; // a new message, only the clicker sees it
const UPDATE = 7; // changes the message that was clicked

/** Only the person who clicked sees it (64), and no link previews (4). */
const NO_PREVIEWS = 4;
const PRIVATE_NO_PREVIEWS = 64 | NO_PREVIEWS;

const BUTTON_ID = /^v:([aynr]):([0-9A-HJKMNP-TV-Z]{8})$/;

type Action = "ask" | "confirm" | "cancel" | "remove";
const ACTIONS: Record<string, Action> = { a: "ask", y: "confirm", n: "cancel", r: "remove" };

interface Button {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  label: string;
  custom_id?: string;
  url?: string;
}

function respond(kind: typeof REPLY | typeof UPDATE, content: string, buttons: Button[] = []) {
  return {
    type: kind,
    data: {
      content,
      // A new reply is private (64). An update keeps the privacy of the message it changes, and Discord
      // only accepts the no-preview flag on it.
      flags: kind === REPLY ? PRIVATE_NO_PREVIEWS : NO_PREVIEWS,
      components: buttons.length > 0 ? [{ type: 1, components: buttons }] : [],
      allowed_mentions: { parse: [] },
    },
  };
}

const bold = (text: string) => `**${formatted(text, 90)}**`;

function votesLeft(budget: VoteBudget): string {
  if (budget.total === null || budget.remaining === null) return "You have unlimited votes.";
  return `You have **${budget.remaining} of ${budget.total}** vote${budget.total === 1 ? "" : "s"} left.`;
}

export async function handleInteraction(body: Interaction): Promise<unknown> {
  if (body.application_id !== getEnv().DISCORD_CLIENT_ID) {
    throw new HttpError(400, "wrong_application", "That request was meant for a different application.");
  }
  if (body.type === PING) return { type: PONG };
  if (body.type !== MESSAGE_COMPONENT) return respond(REPLY, "That isn't something I can do.");

  try {
    return await handleButton(body);
  } catch (err) {
    if (err instanceof HttpError) return respond(REPLY, err.message);
    console.error("[discord] button handling failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");
    return respond(REPLY, "Something went wrong on our side. Please try again in a moment.");
  }
}

async function handleButton(body: Interaction) {
  const env = getEnv();
  const match = BUTTON_ID.exec(body.data?.custom_id ?? "");
  if (!match) return respond(REPLY, "That button isn't valid any more.");
  const action = ACTIONS[match[1]!]!;
  const publicId = match[2]!;
  // The first button is on the public post (answer in a new private message);
  // the rest are on that private message (change it in place).
  const kind = action === "ask" ? REPLY : UPDATE;

  if (action === "cancel") return respond(UPDATE, "Okay, nothing changed.");

  if (body.guild_id !== env.DISCORD_GUILD_ID) return respond(kind, "This only works in the server it was set up for.");
  const member = parseMember(body.member);
  if (!member) return respond(kind, "I couldn't tell who you are. Try again from inside the server.");

  const allowed = rateLimit(`discord-vote:${member.discordId}`, 20, 60_000);
  if (!allowed.allowed) return respond(kind, "You're clicking too quickly. Wait a few seconds and try again.");

  const settings = await getSettings();
  const site = `${env.siteOrigin}/s/${publicId}`;
  const siteButton: Button = { type: 2, style: 5, label: "Open on the site", url: site };

  if (!settings.discordBoardEnabled) {
    return respond(kind, "Voting from Discord is switched off right now. You can still vote on the site.", [siteButton]);
  }

  const suggestion = await prisma.suggestion.findUnique({ where: { publicId }, include: { status: true } });
  if (!suggestion || suggestion.approval !== "APPROVED" || !suggestion.status) {
    return respond(kind, "That suggestion isn't available any more.");
  }
  const title = bold(suggestion.title);
  const closed = `Voting is closed for ${title}: it's now in **${formatted(suggestion.status.name, 40)}**. Votes already cast still count.`;

  const voter = await resolveVoter(member, settings);
  if ("message" in voter) return respond(kind, voter.message);
  const user = voter.user;

  if (action === "confirm") {
    try {
      const result = await castVote(user, publicId);
      return respond(UPDATE, `Your vote for ${title} is in. ${votesLeft(result.budget)}`);
    } catch (err) {
      const refused = await refusal(err, user, closed);
      return respond(UPDATE, refused.text, refused.buttons);
    }
  }

  if (action === "remove") {
    try {
      const result = await retractVote(user, publicId);
      return respond(UPDATE, `Your vote for ${title} was removed. ${votesLeft(result.budget)}`);
    } catch (err) {
      const refused = await refusal(err, user, closed);
      return respond(UPDATE, refused.text, refused.buttons);
    }
  }

  // The Vote button on the post: say where they stand and ask them to confirm.
  const existing = await prisma.vote.findUnique({
    where: { suggestionId_userId: { suggestionId: suggestion.id, userId: user.id } },
  });
  const budget = await getVoteBudget(user.id);

  if (existing) {
    if (!suggestion.status.votingOpen) return respond(REPLY, closed);
    return respond(REPLY, `You've already voted for ${title}. ${votesLeft(budget)}\nWant to take your vote back?`, [
      { type: 2, style: 4, label: "Remove my vote", custom_id: `v:r:${publicId}` },
      { type: 2, style: 2, label: "Keep it", custom_id: `v:n:${publicId}` },
    ]);
  }

  const block = participationBlock(user, settings);
  if (block) return respond(REPLY, block.message);
  if (!suggestion.status.votingOpen) return respond(REPLY, closed);

  if (budget.remaining === 0) return respond(REPLY, outOfVotes(budget), [siteVotesButton()]);

  return respond(REPLY, `${votesLeft(budget)}\nUse one on ${title}?`, [
    { type: 2, style: 3, label: "Confirm vote", custom_id: `v:y:${publicId}` },
    { type: 2, style: 2, label: "Cancel", custom_id: `v:n:${publicId}` },
  ]);
}

function siteVotesButton(): Button {
  return { type: 2, style: 5, label: "Manage my votes", url: `${getEnv().siteOrigin}/me` };
}

function outOfVotes(budget: VoteBudget): string {
  return (
    `You've used all **${budget.total}** of your votes, so you can't vote for this one right now.\n` +
    "A vote comes back when a suggestion you voted for moves on. You can also take a vote back from one you no longer care about."
  );
}

/** Turns a refused vote into something to say to the person who clicked. Anything unexpected is passed on. */
async function refusal(err: unknown, user: User, closed: string): Promise<{ text: string; buttons: Button[] }> {
  if (!(err instanceof HttpError)) throw err;
  switch (err.code) {
    case "out_of_votes":
      return { text: outOfVotes(await getVoteBudget(user.id)), buttons: [siteVotesButton()] };
    case "voting_closed":
      return { text: closed, buttons: [] };
    case "not_found":
      return { text: "That suggestion isn't available any more.", buttons: [] };
    default:
      return { text: err.message, buttons: [] };
  }
}

// ── Who clicked ──────────────────────────────────────────────────────

/**
 * The site account for a person in the server. Their details are refreshed
 * from what Discord just told us. Someone new gets an account only if they
 * hold the Member role, and never as the owner: ownership is only ever claimed
 * by signing in on the site.
 */
async function resolveVoter(member: GuildMember, settings: Settings): Promise<{ user: User } | { message: string }> {
  const existing = await prisma.user.findUnique({ where: { discordId: member.discordId } });
  if (existing?.blockedAt) return { message: "Your account is not able to take part." };
  if (existing) {
    const user = await applyMembership(existing.id, member);
    return { user };
  }

  if (!settings.memberRoleId) return { message: "This hasn't finished being set up yet." };
  if (!holdsMemberRole(member, settings)) return { message: "You need the Member role in the Discord server to vote." };

  try {
    const user = await prisma.user.create({
      data: { discordId: member.discordId, ...identityColumns(member, settings), isOwner: false },
    });
    await audit({ action: "discord.account_created", actor: user, targetType: "user", targetId: user.id, details: { via: "discord button" } });
    return { user };
  } catch (err) {
    // Two first clicks at once: the other one created the account.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { user: await prisma.user.findUniqueOrThrow({ where: { discordId: member.discordId } }) };
    }
    throw err;
  }
}
