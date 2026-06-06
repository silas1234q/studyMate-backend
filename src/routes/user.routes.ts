import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { onboardUser, handleGetPreferences } from "../controllers/user.controller";

const router = Router();

router.post("/onboarding", requireClerkAuth, onboardUser);
router.get("/preferences", requireClerkAuth, handleGetPreferences);

export default router;
