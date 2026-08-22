-- CourseMaterial: materials are no longer image-only
ALTER TABLE "CourseMaterial" RENAME COLUMN "imageUrl" TO "fileUrl";
ALTER TABLE "CourseMaterial" ADD COLUMN "fileName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CourseMaterial" ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE "CourseMaterial" ALTER COLUMN "fileName" DROP DEFAULT;
ALTER TABLE "CourseMaterial" ALTER COLUMN "mimeType" DROP DEFAULT;

-- ChatMessage: attachments can be documents, not just images
ALTER TABLE "ChatMessage" RENAME COLUMN "imageUrl" TO "attachmentUrl";
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "attachmentType" TEXT;

-- QuickChatMessage: attachments in quick chat
ALTER TABLE "QuickChatMessage" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "QuickChatMessage" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "QuickChatMessage" ADD COLUMN "attachmentType" TEXT;
