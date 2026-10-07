import cron from "node-cron";
import prisma from "../config/db.config";
import { createNotification } from "../services/notification.service";
import { NotificationType } from "../types/notification.types";

function getLocalTimeInfo(timezone: string) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")!.value;
  const minute = parts.find((p) => p.type === "minute")!.value;
  const localTime = `${hour}:${minute}`;

  const dayOfWeek = now.toLocaleDateString("en-US", { timeZone: timezone, weekday: "short" });
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const localDay = dayMap[dayOfWeek] ?? 0;

  const dateParts = dateFormatter.formatToParts(now);
  const year = dateParts.find((p) => p.type === "year")!.value;
  const month = dateParts.find((p) => p.type === "month")!.value;
  const day = dateParts.find((p) => p.type === "day")!.value;
  const localDate = `${year}-${month}-${day}`;

  return { localTime, localDay, localDate };
}

export function startStudyReminderCron() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const schedules = await prisma.studySchedule.findMany({
        where: { isActive: true },
        include: {
          user: {
            include: { preferences: { select: { timezone: true } } },
          },
          enrollment: {
            include: { course: { select: { id: true, title: true } } },
          },
        },
      });

      for (const schedule of schedules) {
        try {
          const timezone = schedule.user.preferences?.timezone ?? "UTC";
          const { localTime, localDay, localDate } = getLocalTimeInfo(timezone);

          if (!schedule.daysOfWeek.includes(localDay)) continue;
          if (localTime !== schedule.time) continue;

          // Deduplicate: check if we already sent a STUDY_REMINDER for this user+course today
          const existing = await prisma.notification.findFirst({
            where: {
              userId: schedule.userId,
              type: NotificationType.STUDY_REMINDER,
              createdAt: { gte: new Date(`${localDate}T00:00:00Z`) },
              data: { path: ["courseId"], equals: schedule.enrollment.courseId },
            },
          });
          if (existing) continue;

          await createNotification(
            schedule.userId,
            NotificationType.STUDY_REMINDER,
            "Time to study!",
            `It's time for your ${schedule.enrollment.course.title} session.`,
            { courseId: schedule.enrollment.courseId },
          );
        } catch (err) {
          console.error(`[CRON] Study reminder error for schedule ${schedule.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[CRON] Study reminder cron failed:", err);
    }
  });


}
