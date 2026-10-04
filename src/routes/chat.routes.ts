import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { handleTopicChat, getTopicChatHistory } from "../controllers/chat.controller";
import { handleChatAttachmentUpload } from "../controllers/material.controller";
import { upload, handleUploadErrors } from "../middleware/upload.middleware";

const router = Router();

// Strict rate limit for AI chat: 10 requests per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many AI requests, please slow down." },
});

router.post("/topic", requireClerkAuth, aiLimiter, handleTopicChat);
router.get("/topic/:topicId/history", requireClerkAuth, getTopicChatHistory);
router.post("/attachment", requireClerkAuth, aiLimiter, upload.single("file"), handleUploadErrors, handleChatAttachmentUpload);

export default router;
