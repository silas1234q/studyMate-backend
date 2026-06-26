-- CreateIndex
CREATE INDEX "ChatMessage_userId_topicId_idx" ON "ChatMessage"("userId", "topicId");

-- CreateIndex
CREATE INDEX "DailyActivity_userId_idx" ON "DailyActivity"("userId");

-- CreateIndex
CREATE INDEX "Enrollment_userId_idx" ON "Enrollment"("userId");

-- CreateIndex
CREATE INDEX "QuickChatMessage_conversationId_idx" ON "QuickChatMessage"("conversationId");

-- CreateIndex
CREATE INDEX "QuickConversation_userId_idx" ON "QuickConversation"("userId");

-- CreateIndex
CREATE INDEX "UserStreak_totalXp_idx" ON "UserStreak"("totalXp" DESC);
