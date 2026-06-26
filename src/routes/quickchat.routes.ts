import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleCreateConversation,
  handleListConversations,
  handleGetConversation,
  handleDeleteConversation,
  handleQuickChat,
} from "../controllers/quickchat.controller";

const router = Router();

// Strict rate limit for AI chat: 10 requests per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many AI requests, please slow down." },
});

router.post("/conversations", requireClerkAuth, handleCreateConversation);
router.get("/conversations", requireClerkAuth, handleListConversations);
router.get("/conversations/:id", requireClerkAuth, handleGetConversation);
router.delete("/conversations/:id", requireClerkAuth, handleDeleteConversation);
router.post("/conversations/:id/chat", requireClerkAuth, aiLimiter, handleQuickChat);

export default router;
