import prisma from "../config/db.config";
import { NotificationType } from "../types/notification.types";
import { ACHIEVEMENTS } from "../constants/achievements";
import NotFoundError from "../errors/NotFoundError";

// ── CRUD ─────────────────────────────────────────────────────────────────────

export const createNotification = async (
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
) => {
  return prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      data: data ? (data as any) : undefined,
    },
  });
};

export const getNotifications = async (
  userId: string,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);

  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getUnreadCount = async (userId: string) => {
  return prisma.notification.count({ where: { userId, read: false } });
};

export const markAsRead = async (userId: string, notificationId: string) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });
  if (!notification || notification.userId !== userId) {
    throw new NotFoundError("notification");
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  });
};

export const markAllAsRead = async (userId: string) => {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
};

export const deleteNotification = async (
  userId: string,
  notificationId: string,
) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });
  if (!notification || notification.userId !== userId) {
    throw new NotFoundError("notification");
  }

  return prisma.notification.delete({ where: { id: notificationId } });
};

// ── Achievement Detection ────────────────────────────────────────────────────

export const checkAndCreateAchievementNotifications = async (
  userId: string,
) => {
  const streak = await prisma.userStreak.findUnique({ where: { userId } });
  if (!streak) return;

  const [topicsCompleted, coursesEnrolled] = await Promise.all([
    prisma.topicCompletion.count({ where: { userId } }),
    prisma.enrollment.count({ where: { userId } }),
  ]);

  const stats: Record<string, number> = {
    longestStreak: streak.longestStreak,
    totalXp: streak.totalXp,
    topicsCompleted,
    coursesEnrolled,
    daysAtTop: streak.daysAtTop,
  };

  // Get existing achievement notifications to deduplicate
  const existingNotifications = await prisma.notification.findMany({
    where: {
      userId,
      type: {
        in: [
          NotificationType.STREAK_MILESTONE,
          NotificationType.XP_MILESTONE,
          NotificationType.TOPIC_MILESTONE,
          NotificationType.COURSE_MILESTONE,
          NotificationType.LEADERBOARD_ACHIEVEMENT,
        ],
      },
    },
    select: { data: true },
  });

  const existingAchievementIds = new Set(
    existingNotifications
      .map((n) => (n.data as Record<string, unknown> | null)?.achievementId)
      .filter(Boolean),
  );

  const typeMap: Record<string, string> = {
    Streaks: NotificationType.STREAK_MILESTONE,
    "XP Milestones": NotificationType.XP_MILESTONE,
    "Learning Progress": NotificationType.TOPIC_MILESTONE,
    Leaderboard: NotificationType.LEADERBOARD_ACHIEVEMENT,
  };

  for (const achievement of ACHIEVEMENTS) {
    if (existingAchievementIds.has(achievement.id)) continue;
    if (stats[achievement.statKey] < achievement.threshold) continue;

    const notifType =
      achievement.statKey === "coursesEnrolled"
        ? NotificationType.COURSE_MILESTONE
        : typeMap[achievement.category] ?? NotificationType.TOPIC_MILESTONE;

    await createNotification(
      userId,
      notifType,
      achievement.title,
      achievement.description,
      { achievementId: achievement.id, threshold: achievement.threshold },
    );
  }
};
