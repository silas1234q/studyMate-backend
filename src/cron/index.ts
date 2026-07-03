import { startStudyReminderCron } from "./studyReminder.cron";
import { startStreakAtRiskCron } from "./streakAtRisk.cron";

export function startAllCronJobs() {
  startStudyReminderCron();
  startStreakAtRiskCron();
  console.log("[CRON] All cron jobs started");
}
