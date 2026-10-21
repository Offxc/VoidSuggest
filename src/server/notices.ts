import { Prisma, prisma, type User } from "./db";
import type { NoticeDto } from "../shared/types";

type Tx = Prisma.TransactionClient;

export interface NewNotice {
  userId: string;
  kind: "SUGGESTION_APPROVED" | "SUGGESTION_REJECTED" | "STATUS_CHANGED";
  suggestionId: string;
  suggestionTitle: string;
  statusName?: string | null;
  voteReturned?: boolean;
}

export async function createNotices(tx: Tx, notices: NewNotice[]): Promise<void> {
  const CHUNK = 1000;
  for (let i = 0; i < notices.length; i += CHUNK) {
    await tx.notice.createMany({
      data: notices.slice(i, i + CHUNK).map((n) => ({
        userId: n.userId,
        kind: n.kind,
        suggestionId: n.suggestionId,
        suggestionTitle: n.suggestionTitle,
        statusName: n.statusName ?? null,
        voteReturned: n.voteReturned ?? false,
      })),
    });
  }
}

export async function listNotices(user: Pick<User, "id">): Promise<NoticeDto[]> {
  const rows = await prisma.notice.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { suggestion: { select: { publicId: true } } },
  });
  return rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    suggestionPublicId: n.suggestion?.publicId ?? null,
    suggestionTitle: n.suggestionTitle,
    statusName: n.statusName,
    voteReturned: n.voteReturned,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt !== null,
  }));
}

export function unreadCount(userId: string): Promise<number> {
  return prisma.notice.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notice.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
