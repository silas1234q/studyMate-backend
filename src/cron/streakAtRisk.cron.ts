import cron from "node-cron";
import prisma from "../config/db.config";
import { createNotification } from "../services/notification.service";
import { NotificationType } from "../types/notification.types";

export function startStreakAtRiskCron() {
  cron.schedule("0 18 * * *", async () => {
    try {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      const todayStart = new Date(today.toISOString().split("T")[0] + "T00:00:00Z");

      // Find users with active streaks whose last activity was yesterday
      const atRiskStreaks = await prisma.userStreak.findMany({
        where: {
          currentStreak: { gt: 0 },
          lastActivityDate: yesterdayStr,
        },
        select: { userId: true, currentStreak: true },
      });

      for (const streak of atRiskStreaks) {
        try {
          // Deduplicate: one STREAK_AT_RISK per user per day
          const existing = await prisma.notification.findFirst({
            where: {
              userId: streak.userId,
              type: NotificationType.STREAK_AT_RISK,
              createdAt: { gte: todayStart },
            },
          });
          if (existing) continue;

          await createNotification(
            streak.userId,
            NotificationType.STREAK_AT_RISK,
            "Streak at risk!",
            `Your ${streak.currentStreak}-day streak is about to end. Study today to keep it alive!`,
            { currentStreak: streak.currentStreak },
          );
        } catch (err) {
          console.error(`[CRON] Streak-at-risk error for user ${streak.userId}:`, err);
        }
      }
    } catch (err) {
      console.error("[CRON] Streak-at-risk cron failed:", err);
    }
  });

}
