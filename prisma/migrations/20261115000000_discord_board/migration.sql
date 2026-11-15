-- Discord board: where each suggestion was posted, and the channel settings.

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "discordBoardEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discordBoardSince" TIMESTAMP(3),
ADD COLUMN     "discordChannelId" VARCHAR(25),
ADD COLUMN     "discordRoadmapChannelId" VARCHAR(25),
ADD COLUMN     "discordRoadmapHash" VARCHAR(64),
ADD COLUMN     "discordRoadmapMessageId" VARCHAR(25);

-- AlterTable
ALTER TABLE "Suggestion" ADD COLUMN     "discordChannelId" VARCHAR(25),
ADD COLUMN     "discordMessageId" VARCHAR(25),
ADD COLUMN     "discordPostHash" VARCHAR(64),
ADD COLUMN     "discordPostedAt" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written: rules Prisma's schema language cannot express.
-- ─────────────────────────────────────────────────────────────────────────

-- Channel and message ids are Discord snowflakes: digits only. They end up in
-- request paths, so the database refuses anything else.
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_discord_ids_are_snowflakes" CHECK (
  ("discordChannelId" IS NULL OR "discordChannelId" ~ '^[0-9]{5,25}$')
  AND ("discordRoadmapChannelId" IS NULL OR "discordRoadmapChannelId" ~ '^[0-9]{5,25}$')
  AND ("discordRoadmapMessageId" IS NULL OR "discordRoadmapMessageId" ~ '^[0-9]{5,25}$')
);

ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_discord_ids_are_snowflakes" CHECK (
  ("discordChannelId" IS NULL OR "discordChannelId" ~ '^[0-9]{5,25}$')
  AND ("discordMessageId" IS NULL OR "discordMessageId" ~ '^[0-9]{5,25}$')
);

-- A post is a channel and a message together, and only an approved suggestion has one.
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_discord_post_is_whole"
  CHECK (("discordChannelId" IS NULL) = ("discordMessageId" IS NULL));
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_discord_post_only_when_approved"
  CHECK ("discordMessageId" IS NULL OR "approval" = 'APPROVED');
