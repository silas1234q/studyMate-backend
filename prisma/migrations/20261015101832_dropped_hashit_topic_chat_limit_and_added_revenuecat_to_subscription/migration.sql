/*
  Warnings:

  - You are about to drop the column `hashitTopicChatLimit` on the `UsageTracker` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billingProvider" TEXT NOT NULL DEFAULT 'paystack',
ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "originalTransactionId" TEXT,
ADD COLUMN     "revenueCatAppUserId" TEXT,
ADD COLUMN     "revenueCatEntitlementId" TEXT,
ADD COLUMN     "revenueCatProductId" TEXT,
ADD COLUMN     "store" TEXT,
ADD COLUMN     "willRenew" BOOLEAN;

-- AlterTable
ALTER TABLE "UsageTracker" DROP COLUMN IF EXISTS "hashitTopicChatLimit";

-- CreateIndex
CREATE INDEX "Subscription_billingProvider_status_idx" ON "Subscription"("billingProvider", "status");

-- CreateIndex
CREATE INDEX "Subscription_revenueCatAppUserId_idx" ON "Subscription"("revenueCatAppUserId");

-- CreateIndex
CREATE INDEX "Subscription_originalTransactionId_idx" ON "Subscription"("originalTransactionId");
