-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN "tutorialCompletedAt" TIMESTAMP(3);

-- Backfill: everyone who already has preferences has been using the app,
-- so they should not be walked through the tutorial.
UPDATE "UserPreferences" SET "tutorialCompletedAt" = NOW();
