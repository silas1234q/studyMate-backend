-- Messages can carry several attachments (up to 5) instead of one.
--
-- Deliberately ADDITIVE ONLY. The old singular columns are backfilled into the
-- new arrays but NOT dropped, so this migration is safe to run against live
-- data and can be rolled back by dropping the three new columns per table.
-- Nothing reads the old columns any more; they are dropped in a follow-up
-- migration once this has been running happily for a while.
--
-- Written by hand rather than generated: letting Prisma reconcile the schema
-- would drop the old columns in the same step and take every attachment
-- already sent with them.

-- ── ChatMessage ──────────────────────────────────────────────────────────────
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "attachmentUrls"  TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "attachmentNames" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "attachmentTypes" TEXT[] NOT NULL DEFAULT '{}';

-- Only rows that actually had an attachment, and only those not already
-- backfilled, so re-running is harmless. name/type were nullable even when a
-- url was present, so they are coalesced to keep the three arrays index-aligned.
UPDATE "ChatMessage"
SET "attachmentUrls"  = ARRAY["attachmentUrl"],
    "attachmentNames" = ARRAY[COALESCE("attachmentName", '')],
    "attachmentTypes" = ARRAY[COALESCE("attachmentType", '')]
WHERE "attachmentUrl" IS NOT NULL
  AND cardinality("attachmentUrls") = 0;

-- ── QuickChatMessage ─────────────────────────────────────────────────────────
ALTER TABLE "QuickChatMessage" ADD COLUMN IF NOT EXISTS "attachmentUrls"  TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "QuickChatMessage" ADD COLUMN IF NOT EXISTS "attachmentNames" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "QuickChatMessage" ADD COLUMN IF NOT EXISTS "attachmentTypes" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "QuickChatMessage"
SET "attachmentUrls"  = ARRAY["attachmentUrl"],
    "attachmentNames" = ARRAY[COALESCE("attachmentName", '')],
    "attachmentTypes" = ARRAY[COALESCE("attachmentType", '')]
WHERE "attachmentUrl" IS NOT NULL
  AND cardinality("attachmentUrls") = 0;
