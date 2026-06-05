import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { handleTopicChat, handleGetChatHistory } from "../controllers/chat.controller";

const router = Router();

router.post("/topic", requireClerkAuth, handleTopicChat);
router.get("/topic/:topicId/history", requireClerkAuth, handleGetChatHistory);

export default router;
