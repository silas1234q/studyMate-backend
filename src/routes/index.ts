import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import chatRoutes from "./chat.routes";
import courseRoutes from "./course.routes";
import illustrationsRoutes from "./illustrations.routes";
import streakRoutes from "./streak.routes";
import quickChatRoutes from "./quickchat.routes";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/chat", chatRoutes);
router.use("/courses", courseRoutes);
router.use("/illustrations", illustrationsRoutes);
router.use("/streak", streakRoutes);
router.use("/quick-chat", quickChatRoutes);

export default router;
