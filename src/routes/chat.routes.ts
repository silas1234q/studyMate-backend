import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { handleTopicChat } from "../controllers/chat.controller";

const router = Router();

router.post("/topic", requireClerkAuth, handleTopicChat);

export default router;
