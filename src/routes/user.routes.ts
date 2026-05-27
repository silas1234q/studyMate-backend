import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { onboardUser } from "../controllers/user.controller";

const router = Router();

router.post("/onboarding", requireClerkAuth, onboardUser);

export default router;
