import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import chatRoutes from "./chat.routes";
import courseRoutes from "./course.routes";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/chat", chatRoutes);
router.use("/courses", courseRoutes);

export default router;
