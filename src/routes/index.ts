import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import chatRoutes from "./chat.routes";
import courseRoutes from "./course.routes";
import streakRoutes from "./streak.routes";
import quickChatRoutes from "./quickchat.routes";
import subscriptionRoutes from "./subscription.routes";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/chat", chatRoutes);
router.use("/courses", courseRoutes);
router.use("/streak", streakRoutes);
router.use("/quick-chat", quickChatRoutes);
router.use("/subscription", subscriptionRoutes);

export default router;
