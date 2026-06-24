import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleGetSubscription,
  handleInitiateUpgrade,
  handleVerifyPayment,
  handleCancelSubscription,
} from "../controllers/subscription.controller";

const router = Router();

router.get("/", requireClerkAuth, handleGetSubscription);
router.post("/upgrade", requireClerkAuth, handleInitiateUpgrade);
router.get("/verify", requireClerkAuth, handleVerifyPayment);
router.post("/cancel", requireClerkAuth, handleCancelSubscription);
// Webhook is mounted separately in app.ts (needs raw body)

export default router;
