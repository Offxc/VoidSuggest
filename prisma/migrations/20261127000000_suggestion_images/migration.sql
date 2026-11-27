-- Image uploads on suggestions, and deleting them some days after a
-- suggestion reaches a status such as "Completed".

-- AlterEnum
ALTER TYPE "TimelineKind" ADD VALUE 'IMAGES_REMOVED';

-- AlterTable
ALTER TABLE "Status" ADD COLUMN     "imageRetentionDays" INTEGER;

-- CreateTable
CREATE TABLE "SuggestionImage" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionImage_suggestionId_position_key" ON "SuggestionImage"("suggestionId", "position");

-- AddForeignKey
ALTER TABLE "SuggestionImage" ADD CONSTRAINT "SuggestionImage_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written: rules Prisma's schema language cannot express.
-- ─────────────────────────────────────────────────────────────────────────

-- Four pictures at most, however the rows get there: with the unique index on
-- (suggestionId, position), positions 0 to 3 allow exactly four.
ALTER TABLE "SuggestionImage" ADD CONSTRAINT "SuggestionImage_position_range" CHECK ("position" BETWEEN 0 AND 3);

-- Small, and a plausible picture. The server only ever stores what it made
-- itself (a re-encoded WebP no larger than 1600 pixels a side); this refuses
-- anything else that might reach the table.
ALTER TABLE "SuggestionImage" ADD CONSTRAINT "SuggestionImage_size_sane" CHECK (
  octet_length("data") BETWEEN 1 AND 2000000
  AND "width" BETWEEN 1 AND 4096
  AND "height" BETWEEN 1 AND 4096
);

-- And it must be a WebP: "RIFF", four size bytes, then "WEBP".
ALTER TABLE "SuggestionImage" ADD CONSTRAINT "SuggestionImage_is_webp" CHECK (
  substring("data" from 1 for 4) = '\x52494646'::bytea
  AND substring("data" from 9 for 4) = '\x57454250'::bytea
);

ALTER TABLE "Status" ADD CONSTRAINT "Status_image_retention_range" CHECK (
  "imageRetentionDays" IS NULL OR "imageRetentionDays" BETWEEN 1 AND 3650
);

-- Existing installs: pictures go 30 days after a suggestion is Completed.
UPDATE "Status" SET "imageRetentionDays" = 30 WHERE "slug" = 'completed';
