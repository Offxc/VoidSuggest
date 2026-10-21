import type { ColorKey, IconKey } from "./constants";

/**
 * The shapes the server hands to pages and the browser. Rows from the
 * database are never passed through directly; they are mapped into these, so
 * only fields meant to be public (or meant for that particular viewer) leave
 * the server. Dates are ISO strings.
 */

export interface PersonDto {
  /** Internal id. Discord IDs are never sent to the browser. */
  id: string;
  name: string;
  avatarUrl: string;
  isOwner: boolean;
}

export interface StatusDto {
  id: string;
  name: string;
  slug: string;
  color: ColorKey;
  sortOrder: number;
  isDefault: boolean;
  votingOpen: boolean;
  closesCommentsOnEntry: boolean;
  showOnRoadmap: boolean;
}

export interface TypeDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: ColorKey;
  icon: IconKey;
  enabled: boolean;
  sortOrder: number;
}

export interface TagDto {
  id: string;
  name: string;
  slug: string;
  color: ColorKey;
  sortOrder: number;
}

export interface GuidelineDto {
  id: string;
  title: string;
  body: string;
  sortOrder: number;
  appliesToAll: boolean;
  typeIds: string[];
}

export type Approval = "PENDING" | "APPROVED" | "REJECTED";
export type CommentsModeDto = "OFF" | "OPEN" | "CLOSED";

export interface SuggestionCardDto {
  publicId: string;
  title: string;
  excerpt: string;
  type: TypeDto | null;
  tags: TagDto[];
  status: StatusDto | null;
  approval: Approval;
  voteCount: number;
  commentCount: number;
  commentsMode: CommentsModeDto;
  createdAt: string;
  author: PersonDto;
  viewerHasVoted: boolean;
}

export interface TimelineDto {
  id: string;
  kind: "SUBMITTED" | "APPROVED" | "STATUS_CHANGED" | "COMMENTS_OPENED" | "COMMENTS_CLOSED" | "EDITED";
  fromStatusName: string | null;
  toStatusName: string | null;
  createdAt: string;
}

export interface SuggestionDetailDto extends SuggestionCardDto {
  body: string;
  /** Only sent to the author and the owner. */
  rejectionReason: string | null;
  timeline: TimelineDto[];
  viewerIsAuthor: boolean;
}

export interface CommentDto {
  id: string;
  /** Null once deleted. */
  body: string | null;
  deleted: boolean;
  createdAt: string;
  editedAt: string | null;
  author: PersonDto;
  canEdit: boolean;
  canDelete: boolean;
}

export interface VoteBudgetDto {
  total: number | null;
  used: number;
  remaining: number | null;
}

export interface ViewerDto {
  id: string;
  name: string;
  avatarUrl: string;
  isOwner: boolean;
  /** Null when allowed to submit, vote and comment. */
  participationMessage: string | null;
  unreadNotices: number;
  budget: VoteBudgetDto | null;
}

export interface NoticeDto {
  id: string;
  kind: "SUGGESTION_APPROVED" | "SUGGESTION_REJECTED" | "STATUS_CHANGED";
  suggestionPublicId: string | null;
  suggestionTitle: string;
  statusName: string | null;
  voteReturned: boolean;
  createdAt: string;
  read: boolean;
}

export interface SiteDto {
  siteName: string;
  accentColor: ColorKey;
  introText: string | null;
  discordInviteUrl: string | null;
  voteSlots: number | null;
  submissionsOpen: boolean;
}
