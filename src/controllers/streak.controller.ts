import { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import {
  getStreakData,
  recordActivity,
  getLeaderboard,
  getAchievements,
} from "../services/streak.service";

export const handleGetStreak = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const data = await getStreakData(userId);
    res.json(data);
  }
);

export const handleRecordActivity = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const { type, metadata } = req.body as {
      type?: unknown;
      metadata?: { topicId?: string; courseId?: string };
    };

    if (type !== "chat_message" && type !== "topic_complete") {
      throw new ValidationError("type must be 'chat_message' or 'topic_complete'");
    }

    const result = await recordActivity(userId, type, metadata);
    res.json(result);
  }
);

export const handleGetAchievements = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const data = await getAchievements(userId);
    res.json(data);
  }
);

export const handleGetLeaderboard = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const limit = Math.min(
      50,
      Math.max(1, parseInt((req.query.limit as string) ?? "10", 10) || 10)
    );

    const data = await getLeaderboard(userId, limit);
    res.json(data);
  }
);
