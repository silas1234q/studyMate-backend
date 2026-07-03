import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { onboardUser, handleGetPreferences, handleUpdatePreferences } from "../controllers/user.controller";

const router = Router();

router.post("/onboarding", requireClerkAuth, onboardUser);
router.get("/preferences", requireClerkAuth, handleGetPreferences);
router.patch("/preferences", requireClerkAuth, handleUpdatePreferences);

export default router;
