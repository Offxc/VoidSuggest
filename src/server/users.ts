import { PAGE_SIZE } from "../shared/constants";
import { prisma, type AuditLog, type Prisma, type User } from "./db";
import { audit } from "./audit";
import { avatarUrl } from "./discord";
import { conflict, forbidden, notFound } from "./errors";
import { removeVotesForUser } from "./votes";

function assertOwner(actor: User): void {
  if (!actor.isOwner) throw forbidden();
}

export interface AdminUserDto {
  id: string;
  name: string;
  avatarUrl: string;
  isOwner: boolean;
  isMember: boolean;
  blocked: boolean;
  blockedReason: string | null;
  joinedGuildAt: string | null;
  lastLoginAt: string | null;
  suggestions: number;
  votes: number;
  comments: number;
}

export async function listUsers(
  actor: User,
  query: { q?: string; page: number },
): Promise<{ items: AdminUserDto[]; total: number; pageCount: number }> {
  assertOwner(actor);
  const where: Prisma.UserWhereInput = query.q
    ? { OR: [{ displayName: { contains: query.q, mode: "insensitive" } }, { username: { contains: query.q, mode: "insensitive" } }] }
    : {};
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ isOwner: "desc" }, { lastLoginAt: { sort: "desc", nulls: "last" } }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { suggestions: true, votes: true, comments: true } } },
    }),
  ]);
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    items: rows.map((u) => ({
      id: u.id,
      name: u.displayName,
      avatarUrl: avatarUrl(u),
      isOwner: u.isOwner,
      isMember: u.isMember,
      blocked: u.blockedAt !== null,
      blockedReason: u.blockedReason,
      joinedGuildAt: u.joinedGuildAt?.toISOString() ?? null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      suggestions: u._count.suggestions,
      votes: u._count.votes,
      comments: u._count.comments,
    })),
  };
}

/**
 * Blocks someone from signing in and taking part. Ends their sessions
 * immediately (bumping the version invalidates every cookie they hold) and
 * withdraws their votes from open suggestions.
 */
export async function blockUser(actor: User, userId: string, reason: string | undefined, request?: Request): Promise<void> {
  assertOwner(actor);
  if (userId === actor.id) throw conflict("self", "You can't block yourself.");
  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw notFound("User not found.");
    if (target.isOwner) throw conflict("owner", "The owner can't be blocked.");
    await tx.user.update({
      where: { id: userId },
      data: { blockedAt: new Date(), blockedReason: reason || null, sessionVersion: { increment: 1 } },
    });
    await removeVotesForUser(tx, userId, { onlyOpen: true });
  });
  await audit({ action: "user.block", actor, targetType: "user", targetId: userId, details: { reason }, request });
}

export async function unblockUser(actor: User, userId: string, request?: Request): Promise<void> {
  assertOwner(actor);
  const result = await prisma.user.updateMany({
    where: { id: userId, blockedAt: { not: null } },
    data: { blockedAt: null, blockedReason: null },
  });
  if (result.count === 0) throw notFound("That user isn't blocked.");
  await audit({ action: "user.unblock", actor, targetType: "user", targetId: userId, request });
}

// ── Audit log reads ──────────────────────────────────────────────────

export interface AuditQuery {
  action?: string;
  outcome?: "SUCCESS" | "DENIED" | "FAILURE";
  actor?: string;
  page: number;
}

function auditWhere(query: AuditQuery): Prisma.AuditLogWhereInput {
  return {
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...(query.actor ? { actorName: { contains: query.actor, mode: "insensitive" as const } } : {}),
  };
}

export async function listAudit(
  actor: User,
  query: AuditQuery,
): Promise<{ items: AuditLog[]; total: number; pageCount: number }> {
  assertOwner(actor);
  const where = auditWhere(query);
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (query.page - 1) * 50, take: 50 }),
  ]);
  return { items, total, pageCount: Math.max(1, Math.ceil(total / 50)) };
}

export async function exportAudit(actor: User, query: Omit<AuditQuery, "page">): Promise<AuditLog[]> {
  assertOwner(actor);
  return prisma.auditLog.findMany({ where: auditWhere({ ...query, page: 1 }), orderBy: { id: "desc" }, take: 5000 });
}
