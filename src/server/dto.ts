import type { Guideline, GuidelineType } from "../../generated/prisma/client";
import { COLOR_KEYS, ICON_KEYS, type ColorKey, type IconKey } from "../shared/constants";
import type {
  CommentDto,
  GuidelineDto,
  PersonDto,
  StatusDto,
  SuggestionCardDto,
  SuggestionDetailDto,
  TagDto,
  TimelineDto,
  TypeDto,
} from "../shared/types";
import type { Comment, Settings, Status, SuggestionType, Tag, User } from "./db";
import { avatarUrl } from "./discord";

export function toColor(value: string): ColorKey {
  return (COLOR_KEYS as readonly string[]).includes(value) ? (value as ColorKey) : "purple";
}

function toIcon(value: string): IconKey {
  return (ICON_KEYS as readonly string[]).includes(value) ? (value as IconKey) : "sparkle";
}

export function toPerson(user: Pick<User, "id" | "displayName" | "discordId" | "avatarHash" | "guildAvatarHash" | "isOwner">): PersonDto {
  return { id: user.id, name: user.displayName, avatarUrl: avatarUrl(user), isOwner: user.isOwner };
}

export function toStatus(s: Status): StatusDto {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    color: toColor(s.color),
    sortOrder: s.sortOrder,
    isDefault: s.isDefault,
    votingOpen: s.votingOpen,
    closesCommentsOnEntry: s.closesCommentsOnEntry,
    showOnRoadmap: s.showOnRoadmap,
  };
}

export function toType(t: SuggestionType): TypeDto {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    description: t.description,
    color: toColor(t.color),
    icon: toIcon(t.icon),
    enabled: t.enabled,
    sortOrder: t.sortOrder,
  };
}

export function toTag(t: Tag): TagDto {
  return { id: t.id, name: t.name, slug: t.slug, color: toColor(t.color), sortOrder: t.sortOrder };
}

export function toGuideline(g: Guideline & { types: GuidelineType[] }): GuidelineDto {
  return {
    id: g.id,
    title: g.title,
    body: g.body,
    sortOrder: g.sortOrder,
    appliesToAll: g.appliesToAll,
    typeIds: g.types.map((t) => t.typeId),
  };
}

export function toSite(s: Settings) {
  return {
    siteName: s.siteName,
    accentColor: toColor(s.accentColor),
    introText: s.introText,
    discordInviteUrl: s.discordInviteUrl,
    voteSlots: s.voteSlots,
    submissionsOpen: s.submissionsOpen,
  };
}

/** Plain-text preview of markdown for list cards. */
export function excerptOf(body: string, max = 220): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

export interface SuggestionRow {
  publicId: string;
  title: string;
  body: string;
  approval: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  voteCount: number;
  commentCount: number;
  commentsMode: "OFF" | "OPEN" | "CLOSED";
  createdAt: Date;
  author: User;
  type: SuggestionType | null;
  status: Status | null;
  tags: { tag: Tag }[];
}

export function toCard(row: SuggestionRow, viewerHasVoted: boolean): SuggestionCardDto {
  return {
    publicId: row.publicId,
    title: row.title,
    excerpt: excerptOf(row.body),
    type: row.type ? toType(row.type) : null,
    tags: row.tags.map((t) => toTag(t.tag)).sort((a, b) => a.sortOrder - b.sortOrder),
    status: row.status ? toStatus(row.status) : null,
    approval: row.approval,
    voteCount: row.voteCount,
    commentCount: row.commentCount,
    commentsMode: row.commentsMode,
    createdAt: row.createdAt.toISOString(),
    author: toPerson(row.author),
    viewerHasVoted,
  };
}

export function toDetail(
  row: SuggestionRow & { timeline: { id: string; kind: TimelineDto["kind"]; fromStatusName: string | null; toStatusName: string | null; createdAt: Date }[] },
  viewer: { id: string; isOwner: boolean } | null,
  viewerHasVoted: boolean,
): SuggestionDetailDto {
  const isAuthor = viewer?.id === row.author.id;
  return {
    ...toCard(row, viewerHasVoted),
    body: row.body,
    // The reason for a rejection is for the person it concerns, not the public.
    rejectionReason: isAuthor || viewer?.isOwner ? row.rejectionReason : null,
    viewerIsAuthor: isAuthor,
    timeline: row.timeline.map((t) => ({
      id: t.id,
      kind: t.kind,
      fromStatusName: t.fromStatusName,
      toStatusName: t.toStatusName,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export function toComment(
  row: Comment & { author: User },
  viewer: { id: string; isOwner: boolean } | null,
  commentsOpen: boolean,
  now = Date.now(),
  editWindowMs = 15 * 60 * 1000,
): CommentDto {
  const deleted = row.deletedAt !== null;
  const own = viewer?.id === row.authorId;
  return {
    id: row.id,
    body: deleted ? null : row.body,
    deleted,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    author: toPerson(row.author),
    canEdit: !deleted && own && commentsOpen && now - row.createdAt.getTime() < editWindowMs,
    canDelete: !deleted && (own || Boolean(viewer?.isOwner)),
  };
}
