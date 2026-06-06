import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { handleTopicChat, getTopicChatHistory } from "../controllers/chat.controller";

const router = Router();

router.post("/topic", requireClerkAuth, handleTopicChat);
router.get("/topic/:topicId/history", requireClerkAuth, getTopicChatHistory);

export default router;
