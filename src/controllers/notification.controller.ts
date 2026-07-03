import { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "../services/notification.service";

async function resolveUserId(req: Request): Promise<string> {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) throw new AuthError("user not authenticated");
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");
  return user.id;
}

export const handleGetNotifications = catchAsync(
  async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await getNotifications(userId, page, limit);
    res.json(result);
  },
);

export const handleGetUnreadCount = catchAsync(
  async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    const count = await getUnreadCount(userId);
    res.json({ count });
  },
);

export const handleMarkAsRead = catchAsync(
  async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    const result = await markAsRead(userId, req.params.id as string);
    res.json(result);
  },
);

export const handleMarkAllAsRead = catchAsync(
  async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    await markAllAsRead(userId);
    res.json({ success: true });
  },
);

export const handleDeleteNotification = catchAsync(
  async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    await deleteNotification(userId, req.params.id as string);
    res.json({ success: true });
  },
);
