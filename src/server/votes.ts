import { Prisma, prisma, type Settings, type User } from "./db";
import { audit } from "./audit";
import { conflict, forbidden, notFound } from "./errors";
import { participationBlock } from "./eligibility";
import { getSettings } from "./settings";

type Tx = Prisma.TransactionClient;

/**
 * Votes and the vote budget.
 *
 * Every member has a limited number of vote slots. A vote occupies a slot
 * only while its suggestion sits in a status with "voting open"; once the
 * owner moves it somewhere voting is closed (Planned, Completed...), the slot
 * is free again but the vote still counts towards the tally. Slots used is
 * always computed from the votes themselves, never stored, so it cannot drift.
 */

export interface VoteBudget {
  /** Null means unlimited. */
  total: number | null;
  used: number;
  /** Null means unlimited. */
  remaining: number | null;
}

async function slotsUsed(db: Tx | typeof prisma, userId: string): Promise<number> {
  return db.vote.count({
    where: { userId, suggestion: { approval: "APPROVED", status: { votingOpen: true } } },
  });
}

async function budgetFor(db: Tx | typeof prisma, userId: string, settings: Pick<Settings, "voteSlots">): Promise<VoteBudget> {
  const used = await slotsUsed(db, userId);
  const total = settings.voteSlots;
  return { total, used, remaining: total === null ? null : Math.max(0, total - used) };
}

export async function getVoteBudget(userId: string): Promise<VoteBudget> {
  return budgetFor(prisma, userId, await getSettings());
}

interface LockedSuggestion {
  id: string;
  statusId: string | null;
  approval: string;
}

/**
 * Locks the voter and the suggestion for the rest of the transaction.
 *
 * Locking the voter is what makes the budget safe: two quick clicks from the
 * same person run one after the other, so both cannot see "one slot left".
 * `FOR NO KEY UPDATE` (rather than `FOR UPDATE` / `FOR SHARE`) keeps this
 * compatible with the foreign-key checks other transactions make against these
 * rows, which avoids deadlocks with the owner moving a suggestion at the same time.
 * Lock order is always user, then suggestion.
 */
async function lockVoterAndSuggestion(tx: Tx, userId: string, publicId: string): Promise<LockedSuggestion> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
  const rows = await tx.$queryRaw<LockedSuggestion[]>`
    SELECT "id", "statusId", "approval"::text AS "approval"
    FROM "Suggestion" WHERE "publicId" = ${publicId} FOR NO KEY UPDATE`;
  const suggestion = rows[0];
  if (!suggestion || suggestion.approval !== "APPROVED" || !suggestion.statusId) throw notFound("Suggestion not found.");
  return suggestion;
}

export interface VoteResult {
  voteCount: number;
  hasVoted: boolean;
  budget: VoteBudget;
}

export async function castVote(actor: User, publicId: string): Promise<VoteResult> {
  const settings = await getSettings();
  const block = participationBlock(actor, settings);
  if (block) throw forbidden(block.message, block.code);

  return prisma.$transaction(async (tx) => {
    const locked = await lockVoterAndSuggestion(tx, actor.id, publicId);
    const status = await tx.status.findUniqueOrThrow({ where: { id: locked.statusId! } });
    if (!status.votingOpen) throw conflict("voting_closed", "Voting is closed for this suggestion.");

    const existing = await tx.vote.findUnique({
      where: { suggestionId_userId: { suggestionId: locked.id, userId: actor.id } },
    });

    if (!existing) {
      if (settings.voteSlots !== null && (await slotsUsed(tx, actor.id)) >= settings.voteSlots) {
        throw conflict(
          "out_of_votes",
          `You've used all ${settings.voteSlots} of your votes. Remove one to vote here.`,
        );
      }
      await tx.vote.create({ data: { suggestionId: locked.id, userId: actor.id } });
      await tx.suggestion.update({ where: { id: locked.id }, data: { voteCount: { increment: 1 } } });
    }

    const { voteCount } = await tx.suggestion.findUniqueOrThrow({
      where: { id: locked.id },
      select: { voteCount: true },
    });
    return { voteCount, hasVoted: true, budget: await budgetFor(tx, actor.id, settings) };
  });
}

export async function retractVote(actor: User, publicId: string): Promise<VoteResult> {
  const settings = await getSettings();
  const block = participationBlock(actor, settings, { tenure: false });
  if (block) throw forbidden(block.message, block.code);

  return prisma.$transaction(async (tx) => {
    const locked = await lockVoterAndSuggestion(tx, actor.id, publicId);
    const status = await tx.status.findUniqueOrThrow({ where: { id: locked.statusId! } });
    // Once voting has closed, the tally is part of the record and stays as it was.
    if (!status.votingOpen) throw conflict("voting_closed", "Voting is closed for this suggestion.");

    const removed = await tx.vote.deleteMany({ where: { suggestionId: locked.id, userId: actor.id } });
    if (removed.count > 0) {
      await tx.suggestion.update({ where: { id: locked.id }, data: { voteCount: { decrement: removed.count } } });
    }
    const { voteCount } = await tx.suggestion.findUniqueOrThrow({
      where: { id: locked.id },
      select: { voteCount: true },
    });
    return { voteCount, hasVoted: false, budget: await budgetFor(tx, actor.id, settings) };
  });
}

/**
 * Deletes a person's votes and fixes the tallies in one statement.
 * `onlyOpen` limits it to suggestions that are currently accepting votes.
 */
export async function removeVotesForUser(tx: Tx, userId: string, options: { onlyOpen: boolean }): Promise<number> {
  const scope = options.onlyOpen
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "Suggestion" s JOIN "Status" st ON st."id" = s."statusId"
        WHERE s."id" = v."suggestionId" AND st."votingOpen")`
    : Prisma.empty;
  return tx.$executeRaw`
    WITH removed AS (
      DELETE FROM "Vote" v WHERE v."userId" = ${userId} ${scope} RETURNING v."suggestionId"
    ), tally AS (
      SELECT "suggestionId", count(*)::int AS n FROM removed GROUP BY "suggestionId"
    )
    UPDATE "Suggestion" s SET "voteCount" = GREATEST(0, s."voteCount" - tally.n)
    FROM tally WHERE s."id" = tally."suggestionId"`;
}

// ── Owner tools ──────────────────────────────────────────────────────

function assertOwner(actor: User): void {
  if (!actor.isOwner) throw forbidden();
}

export interface VoterRow {
  userId: string;
  displayName: string;
  votedAt: Date;
}

export async function listVoters(actor: User, publicId: string): Promise<VoterRow[]> {
  assertOwner(actor);
  const votes = await prisma.vote.findMany({
    where: { suggestion: { publicId } },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { createdAt: true, user: { select: { id: true, displayName: true } } },
  });
  return votes.map((v) => ({ userId: v.user.id, displayName: v.user.displayName, votedAt: v.createdAt }));
}

export async function strikeVote(actor: User, publicId: string, voterId: string, request?: Request): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const suggestion = await tx.suggestion.findUnique({ where: { publicId }, select: { id: true } });
    if (!suggestion) throw notFound("Suggestion not found.");
    const removed = await tx.vote.deleteMany({ where: { suggestionId: suggestion.id, userId: voterId } });
    if (removed.count > 0) {
      await tx.suggestion.update({
        where: { id: suggestion.id },
        data: { voteCount: { decrement: removed.count } },
      });
    }
  });
  await audit({
    action: "vote.strike",
    actor,
    targetType: "suggestion",
    targetId: publicId,
    details: { voterId },
    request,
  });
}

export async function strikeAllVotes(actor: User, userId: string, request?: Request): Promise<number> {
  assertOwner(actor);
  const removed = await prisma.$transaction((tx) => removeVotesForUser(tx, userId, { onlyOpen: false }));
  await audit({ action: "vote.strike_all", actor, targetType: "user", targetId: userId, details: { removed }, request });
  return removed;
}
