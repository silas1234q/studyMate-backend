import { Router } from "express";
import { requireClerkAuth } from "../middleware/requireAuth.middleware";
import {
  handleGetNotifications,
  handleGetUnreadCount,
  handleMarkAsRead,
  handleMarkAllAsRead,
  handleDeleteNotification,
} from "../controllers/notification.controller";

const router = Router();

router.get("/", requireClerkAuth, handleGetNotifications);
router.get("/unread-count", requireClerkAuth, handleGetUnreadCount);
router.patch("/read-all", requireClerkAuth, handleMarkAllAsRead);
router.patch("/:id/read", requireClerkAuth, handleMarkAsRead);
router.delete("/:id", requireClerkAuth, handleDeleteNotification);

export default router;
