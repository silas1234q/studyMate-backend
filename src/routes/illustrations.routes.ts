import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import { generateIllustration } from "../controllers/illustrations.controller";

const router = Router();

router.post("/generate", requireClerkAuth, generateIllustration);

export default router;
