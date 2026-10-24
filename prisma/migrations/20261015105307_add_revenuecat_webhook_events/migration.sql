-- CreateTable
CREATE TABLE "RevenueCatWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueCatWebhookEvent_pkey" PRIMARY KEY ("id")
);
