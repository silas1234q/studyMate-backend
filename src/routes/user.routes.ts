import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { onboardUser, handleGetPreferences, handleUpdatePreferences, handleDeleteAccount } from "../controllers/user.controller";

const router = Router();

router.post("/onboarding", requireClerkAuth, onboardUser);
router.get("/preferences", requireClerkAuth, handleGetPreferences);
router.patch("/preferences", requireClerkAuth, handleUpdatePreferences);
router.delete("/account", requireClerkAuth, handleDeleteAccount);

export default router;
