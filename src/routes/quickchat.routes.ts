import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleCreateConversation,
  handleListConversations,
  handleGetConversation,
  handleDeleteConversation,
  handleQuickChat,
} from "../controllers/quickchat.controller";

const router = Router();

router.post("/conversations", requireClerkAuth, handleCreateConversation);
router.get("/conversations", requireClerkAuth, handleListConversations);
router.get("/conversations/:id", requireClerkAuth, handleGetConversation);
router.delete("/conversations/:id", requireClerkAuth, handleDeleteConversation);
router.post("/conversations/:id/chat", requireClerkAuth, handleQuickChat);

export default router;
