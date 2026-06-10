import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleGetStreak,
  handleRecordActivity,
  handleGetLeaderboard,
} from "../controllers/streak.controller";

const router = Router();

router.get("/", requireClerkAuth, handleGetStreak);
router.post("/activity", requireClerkAuth, handleRecordActivity);
router.get("/leaderboard", requireClerkAuth, handleGetLeaderboard);

export default router;
