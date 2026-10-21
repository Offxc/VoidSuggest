import { Prisma, prisma, type User } from "./db";
import { LIMITS, PAGE_SIZE } from "../shared/constants";
import type { BoardQuery } from "../shared/schemas";
import type {
  CommentDto,
  GuidelineDto,
  StatusDto,
  SuggestionCardDto,
  SuggestionDetailDto,
  TagDto,
  TypeDto,
} from "../shared/types";
import { toCard, toComment, toDetail, toGuideline, toStatus, toTag, toType, type SuggestionRow } from "./dto";

/**
 * Reads. The rule that keeps unapproved suggestions private lives here and
 * only here: a public list is always `approval = APPROVED`, and a single
 * suggestion is visible only if it is approved, or the viewer wrote it, or
 * the viewer is the owner.
 */

const cardInclude = {
  author: true,
  type: true,
  status: true,
  tags: { include: { tag: true } },
} satisfies Prisma.SuggestionInclude;

type Viewer = Pick<User, "id" | "isOwner"> | null;

async function votedSet(viewer: Viewer, suggestionIds: string[]): Promise<Set<string>> {
  if (!viewer || suggestionIds.length === 0) return new Set();
  const votes = await prisma.vote.findMany({
    where: { userId: viewer.id, suggestionId: { in: suggestionIds } },
    select: { suggestionId: true },
  });
  return new Set(votes.map((v) => v.suggestionId));
}

async function cards(viewer: Viewer, rows: (SuggestionRow & { id: string })[]): Promise<SuggestionCardDto[]> {
  const voted = await votedSet(viewer, rows.map((r) => r.id));
  return rows.map((r) => toCard(r, voted.has(r.id)));
}

// ── Reference data ───────────────────────────────────────────────────

export async function getStatuses(): Promise<StatusDto[]> {
  return (await prisma.status.findMany({ orderBy: { sortOrder: "asc" } })).map(toStatus);
}

export async function getTypes(options: { enabledOnly?: boolean } = {}): Promise<TypeDto[]> {
  const rows = await prisma.suggestionType.findMany({
    where: options.enabledOnly ? { enabled: true } : undefined,
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toType);
}

export async function getTags(): Promise<TagDto[]> {
  return (await prisma.tag.findMany({ orderBy: { sortOrder: "asc" } })).map(toTag);
}

export async function getGuidelines(): Promise<GuidelineDto[]> {
  const rows = await prisma.guideline.findMany({ orderBy: { sortOrder: "asc" }, include: { types: true } });
  return rows.map(toGuideline);
}

// ── Board ────────────────────────────────────────────────────────────

export interface BoardResult {
  statuses: (StatusDto & { count: number })[];
  current: StatusDto | null;
  items: SuggestionCardDto[];
  total: number;
  page: number;
  pageCount: number;
  types: TypeDto[];
  tags: TagDto[];
}

export async function getBoard(viewer: Viewer, query: BoardQuery): Promise<BoardResult> {
  const [statuses, types, tags, counts] = await Promise.all([
    getStatuses(),
    getTypes(),
    getTags(),
    prisma.suggestion.groupBy({ by: ["statusId"], where: { approval: "APPROVED" }, _count: { _all: true } }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.statusId, c._count._all]));
  const withCounts = statuses.map((s) => ({ ...s, count: countByStatus.get(s.id) ?? 0 }));
  const current = statuses.find((s) => s.slug === query.status) ?? statuses.find((s) => s.isDefault) ?? statuses[0] ?? null;

  if (!current) {
    return { statuses: withCounts, current: null, items: [], total: 0, page: 1, pageCount: 1, types, tags };
  }

  const where: Prisma.SuggestionWhereInput = {
    approval: "APPROVED",
    statusId: current.id,
    ...(query.tag ? { tags: { some: { tag: { slug: query.tag } } } } : {}),
    ...(query.type ? { type: { slug: query.type } } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" } },
            { body: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.suggestion.count({ where }),
    prisma.suggestion.findMany({
      where,
      include: cardInclude,
      orderBy: query.sort === "new" ? [{ createdAt: "desc" }] : [{ voteCount: "desc" }, { createdAt: "asc" }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return {
    statuses: withCounts,
    current,
    items: await cards(viewer, rows),
    total,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    types,
    tags,
  };
}

export interface RoadmapColumn {
  status: StatusDto;
  items: SuggestionCardDto[];
  total: number;
}

export async function getRoadmap(viewer: Viewer): Promise<RoadmapColumn[]> {
  const statuses = (await prisma.status.findMany({ where: { showOnRoadmap: true }, orderBy: { sortOrder: "asc" } })).map(
    toStatus,
  );
  return Promise.all(
    statuses.map(async (status) => {
      const where = { approval: "APPROVED", statusId: status.id } as const;
      const [total, rows] = await Promise.all([
        prisma.suggestion.count({ where }),
        prisma.suggestion.findMany({
          where,
          include: cardInclude,
          orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
          take: 30,
        }),
      ]);
      return { status, items: await cards(viewer, rows), total };
    }),
  );
}

// ── One suggestion ───────────────────────────────────────────────────

export async function getSuggestion(viewer: Viewer, publicId: string): Promise<SuggestionDetailDto | null> {
  const row = await prisma.suggestion.findUnique({
    where: { publicId },
    include: { ...cardInclude, timeline: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) return null;
  const visible = row.approval === "APPROVED" || viewer?.isOwner || viewer?.id === row.authorId;
  // Same answer as "doesn't exist", so pending suggestions can't be discovered by guessing.
  if (!visible) return null;
  const voted = await votedSet(viewer, [row.id]);
  return toDetail(row, viewer, voted.has(row.id));
}

export async function getComments(viewer: Viewer, publicId: string): Promise<CommentDto[]> {
  const suggestion = await prisma.suggestion.findUnique({
    where: { publicId },
    select: { id: true, approval: true, authorId: true, commentsMode: true },
  });
  if (!suggestion || suggestion.approval !== "APPROVED" || suggestion.commentsMode === "OFF") return [];
  const rows = await prisma.comment.findMany({
    where: { suggestionId: suggestion.id },
    include: { author: true },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  return rows.map((r) => toComment(r, viewer, suggestion.commentsMode === "OPEN", Date.now(), LIMITS.commentEditWindowMs));
}

// ── Similar suggestions (shown while typing a title) ────────────────

export interface SimilarHit {
  publicId: string;
  title: string;
  voteCount: number;
  statusName: string;
}

export async function findSimilar(text: string): Promise<SimilarHit[]> {
  const words = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 10))];
  if (words.length === 0) return [];
  // Only letters and digits survive the pattern above, so nothing in this
  // string can act as a query operator.
  const tsQuery = words.join(" | ");
  const rows = await prisma.$queryRaw<{ publicId: string; title: string; voteCount: number; statusName: string }[]>`
    SELECT s."publicId", s."title", s."voteCount", st."name" AS "statusName"
    FROM "Suggestion" s
    JOIN "Status" st ON st."id" = s."statusId"
    WHERE s."approval" = 'APPROVED'
      AND to_tsvector('english', s."title" || ' ' || left(s."body", 500)) @@ to_tsquery('english', ${tsQuery})
    ORDER BY ts_rank(to_tsvector('english', s."title" || ' ' || left(s."body", 500)), to_tsquery('english', ${tsQuery})) DESC,
             s."voteCount" DESC
    LIMIT 5`;
  return rows;
}

// ── A signed-in person's own pages ───────────────────────────────────

export async function getMySuggestions(viewer: Pick<User, "id" | "isOwner">): Promise<SuggestionCardDto[]> {
  const rows = await prisma.suggestion.findMany({
    where: { authorId: viewer.id },
    include: cardInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return cards(viewer, rows);
}

export interface MyVotes {
  /** Votes currently using a slot. */
  occupying: SuggestionCardDto[];
  /** Votes that still count but no longer use a slot (voting has closed). */
  settled: SuggestionCardDto[];
}

export async function getMyVotes(viewer: Pick<User, "id" | "isOwner">): Promise<MyVotes> {
  const votes = await prisma.vote.findMany({
    where: { userId: viewer.id, suggestion: { approval: "APPROVED" } },
    include: { suggestion: { include: cardInclude } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const occupying: SuggestionCardDto[] = [];
  const settled: SuggestionCardDto[] = [];
  for (const v of votes) {
    const card = toCard(v.suggestion, true);
    (v.suggestion.status?.votingOpen ? occupying : settled).push(card);
  }
  return { occupying, settled };
}

// ── Owner views ──────────────────────────────────────────────────────

export async function countPending(): Promise<number> {
  return prisma.suggestion.count({ where: { approval: "PENDING" } });
}

export async function getPendingQueue(): Promise<SuggestionCardDto[]> {
  const rows = await prisma.suggestion.findMany({
    where: { approval: "PENDING" },
    include: cardInclude,
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return rows.map((r) => toCard(r, false));
}

export interface AdminListQuery {
  approval?: "PENDING" | "APPROVED" | "REJECTED";
  status?: string;
  q?: string;
  page: number;
}

export async function getAdminList(query: AdminListQuery): Promise<{ items: SuggestionCardDto[]; total: number; pageCount: number }> {
  const where: Prisma.SuggestionWhereInput = {
    ...(query.approval ? { approval: query.approval } : {}),
    ...(query.status ? { status: { slug: query.status } } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" } },
            { body: { contains: query.q, mode: "insensitive" } },
            { author: { displayName: { contains: query.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.suggestion.count({ where }),
    prisma.suggestion.findMany({
      where,
      include: cardInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { items: rows.map((r) => toCard(r, false)), total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export interface AdminStats {
  pending: number;
  live: number;
  members: number;
  votes: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const [pending, live, members, votes] = await Promise.all([
    prisma.suggestion.count({ where: { approval: "PENDING" } }),
    prisma.suggestion.count({ where: { approval: "APPROVED" } }),
    prisma.user.count({ where: { isMember: true } }),
    prisma.vote.count(),
  ]);
  return { pending, live, members, votes };
}

/** How many suggestions use each status, type and tag, so the settings pages can say what is safe to delete. */
export async function getUsage(): Promise<{
  statuses: Record<string, number>;
  types: Record<string, number>;
  tags: Record<string, number>;
}> {
  const [statuses, types, tags] = await Promise.all([
    prisma.suggestion.groupBy({ by: ["statusId"], _count: { _all: true } }),
    prisma.suggestion.groupBy({ by: ["typeId"], _count: { _all: true } }),
    prisma.suggestionTag.groupBy({ by: ["tagId"], _count: { _all: true } }),
  ]);
  const toMap = (rows: { key: string | null; n: number }[]) =>
    Object.fromEntries(rows.flatMap((r) => (r.key ? [[r.key, r.n]] : [])));
  return {
    statuses: toMap(statuses.map((r) => ({ key: r.statusId, n: r._count._all }))),
    types: toMap(types.map((r) => ({ key: r.typeId, n: r._count._all }))),
    tags: toMap(tags.map((r) => ({ key: r.tagId, n: r._count._all }))),
  };
}
