-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CommentsMode" AS ENUM ('OFF', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('SUGGESTION_APPROVED', 'SUGGESTION_REJECTED', 'STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "TimelineKind" AS ENUM ('SUBMITTED', 'APPROVED', 'STATUS_CHANGED', 'COMMENTS_OPENED', 'COMMENTS_CLOSED', 'EDITED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordId" VARCHAR(32) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "globalName" VARCHAR(64),
    "nick" VARCHAR(64),
    "displayName" VARCHAR(64) NOT NULL,
    "avatarHash" VARCHAR(40),
    "guildAvatarHash" VARCHAR(40),
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "isMember" BOOLEAN NOT NULL DEFAULT false,
    "joinedGuildAt" TIMESTAMP(3),
    "leftGuildAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "blockedReason" VARCHAR(200),
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "ackedGuidelinesVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "siteName" VARCHAR(60) NOT NULL DEFAULT 'VoidSuggest',
    "introText" VARCHAR(1000),
    "accentColor" VARCHAR(16) NOT NULL DEFAULT 'purple',
    "discordInviteUrl" VARCHAR(200),
    "memberRoleId" VARCHAR(32),
    "voteSlots" INTEGER DEFAULT 5,
    "minDaysInServer" INTEGER NOT NULL DEFAULT 0,
    "submissionsOpen" BOOLEAN NOT NULL DEFAULT true,
    "maxPendingPerUser" INTEGER NOT NULL DEFAULT 3,
    "maxSubmissionsPerDay" INTEGER NOT NULL DEFAULT 3,
    "maxTagsPerSuggestion" INTEGER NOT NULL DEFAULT 3,
    "requireGuidelinesAck" BOOLEAN NOT NULL DEFAULT false,
    "guidelinesVersion" INTEGER NOT NULL DEFAULT 1,
    "defaultCommentsMode" "CommentsMode" NOT NULL DEFAULT 'OFF',
    "removeVotesOnLeave" BOOLEAN NOT NULL DEFAULT true,
    "webhookUrlEnc" TEXT,
    "notifyPending" BOOLEAN NOT NULL DEFAULT true,
    "notifyStatusChange" BOOLEAN NOT NULL DEFAULT false,
    "seededAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Status" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "color" VARCHAR(16) NOT NULL DEFAULT 'purple',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "votingOpen" BOOLEAN NOT NULL DEFAULT false,
    "closesCommentsOnEntry" BOOLEAN NOT NULL DEFAULT false,
    "showOnRoadmap" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionType" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "description" VARCHAR(200),
    "color" VARCHAR(16) NOT NULL DEFAULT 'purple',
    "icon" VARCHAR(24) NOT NULL DEFAULT 'sparkle',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SuggestionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "color" VARCHAR(16) NOT NULL DEFAULT 'purple',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guideline" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "appliesToAll" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Guideline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidelineType" (
    "guidelineId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,

    CONSTRAINT "GuidelineType_pkey" PRIMARY KEY ("guidelineId","typeId")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "publicId" VARCHAR(12) NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "typeId" TEXT,
    "approval" "ApprovalState" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" VARCHAR(500),
    "statusId" TEXT,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "commentsMode" "CommentsMode" NOT NULL DEFAULT 'OFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionTag" (
    "suggestionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "SuggestionTag_pkey" PRIMARY KEY ("suggestionId","tagId")
);

-- CreateTable
CREATE TABLE "Vote" (
    "suggestionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("suggestionId","userId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "kind" "TimelineKind" NOT NULL,
    "fromStatusName" VARCHAR(40),
    "toStatusName" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NoticeKind" NOT NULL,
    "suggestionId" TEXT,
    "suggestionTitle" VARCHAR(120) NOT NULL,
    "statusName" VARCHAR(40),
    "voteReturned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" VARCHAR(32),
    "actorName" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "targetType" VARCHAR(32),
    "targetId" VARCHAR(64),
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "details" JSONB,
    "ip" VARCHAR(45),
    "userAgent" VARCHAR(200),

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE INDEX "User_isMember_idx" ON "User"("isMember");

-- CreateIndex
CREATE UNIQUE INDEX "Status_slug_key" ON "Status"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionType_slug_key" ON "SuggestionType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_publicId_key" ON "Suggestion"("publicId");

-- CreateIndex
CREATE INDEX "Suggestion_statusId_voteCount_createdAt_idx" ON "Suggestion"("statusId", "voteCount" DESC, "createdAt");

-- CreateIndex
CREATE INDEX "Suggestion_authorId_approval_idx" ON "Suggestion"("authorId", "approval");

-- CreateIndex
CREATE INDEX "Suggestion_approval_createdAt_idx" ON "Suggestion"("approval", "createdAt");

-- CreateIndex
CREATE INDEX "SuggestionTag_tagId_idx" ON "SuggestionTag"("tagId");

-- CreateIndex
CREATE INDEX "Vote_userId_idx" ON "Vote"("userId");

-- CreateIndex
CREATE INDEX "Comment_suggestionId_createdAt_idx" ON "Comment"("suggestionId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "TimelineEvent_suggestionId_createdAt_idx" ON "TimelineEvent"("suggestionId", "createdAt");

-- CreateIndex
CREATE INDEX "Notice_userId_readAt_createdAt_idx" ON "Notice"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "GuidelineType" ADD CONSTRAINT "GuidelineType_guidelineId_fkey" FOREIGN KEY ("guidelineId") REFERENCES "Guideline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidelineType" ADD CONSTRAINT "GuidelineType_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "SuggestionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "SuggestionType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionTag" ADD CONSTRAINT "SuggestionTag_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionTag" ADD CONSTRAINT "SuggestionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written: rules Prisma's schema language cannot express. Keep this
-- section when regenerating the migration.
-- ─────────────────────────────────────────────────────────────────────────

-- At most one owner, ever. The first-login claim races safely: a second
-- concurrent claim fails this index and falls back to a normal sign-in.
CREATE UNIQUE INDEX "User_single_owner" ON "User" ("isOwner") WHERE "isOwner";

-- Exactly one default status for new approvals.
CREATE UNIQUE INDEX "Status_single_default" ON "Status" ("isDefault") WHERE "isDefault";

-- Settings is a singleton.
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_singleton" CHECK ("id" = 1);
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_vote_slots_range"
  CHECK ("voteSlots" IS NULL OR ("voteSlots" BETWEEN 1 AND 50));
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_default_comments_mode"
  CHECK ("defaultCommentsMode" IN ('OFF', 'OPEN'));

-- A suggestion has a status if and only if it has been approved.
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_approved_has_status"
  CHECK (("approval" = 'APPROVED') = ("statusId" IS NOT NULL));
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_counts_non_negative"
  CHECK ("voteCount" >= 0 AND "commentCount" >= 0);

-- The audit log is append-only. This stops application bugs and injected
-- queries from rewriting history; someone with ownership of the table can
-- still drop the trigger, so keep the database role's rights tight.
CREATE FUNCTION "audit_log_is_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_is_append_only"();
