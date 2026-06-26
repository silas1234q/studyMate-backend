import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { handleTopicChat, getTopicChatHistory } from "../controllers/chat.controller";

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

export default router;
