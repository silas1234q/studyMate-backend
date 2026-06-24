import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";

const DAILY_XP_GOAL = 200;
const CHAT_XP = 20;
const TOPIC_XP = 100;
const MILESTONES = [7, 30, 100] as const;

// ── Date helpers ─────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(earlier: string, later: string): number {
  const msPerDay = 86_400_000;
  return Math.round(
    (new Date(later + "T00:00:00Z").getTime() -
      new Date(earlier + "T00:00:00Z").getTime()) /
      msPerDay
  );
}

function getWeekDates(today: string): string[] {
  const d = new Date(today + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 = Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d);
    day.setUTCDate(d.getUTCDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

// ── Internal helper: upsert streak row ──────────────────────────────────────

async function getOrCreateStreak(userId: string) {
  return prisma.userStreak.upsert({
    where: { userId },
    update: {},
    create: { userId, dailyXpGoal: DAILY_XP_GOAL },
  });
}

// ── Internal helper: apply XP + update streak ────────────────────────────────
// Returns updated values. Caller is responsible for DailyActivity upsert.

async function applyXp(
  userId: string,
  xpAwarded: number
): Promise<{
  streakUpdated: boolean;
  newStreak: number;
  newTotalXp: number;
  newDailyXp: number;
  milestoneReached: 7 | 30 | 100 | null;
}> {
  const streak = await getOrCreateStreak(userId);
  const today = todayUtc();

  const isNewDay = streak.lastActivityDate !== today;
  let newStreak = streak.currentStreak;

  if (isNewDay) {
    if (
      streak.lastActivityDate &&
      daysBetween(streak.lastActivityDate, today) === 1
    ) {
      newStreak = streak.currentStreak + 1;
    } else {
      newStreak = 1;
    }
  }

  const newLongest = Math.max(streak.longestStreak, newStreak);
  const baseDailyXp = isNewDay ? 0 : streak.dailyXp;
  const newDailyXp = baseDailyXp + xpAwarded;
  const newTotalXp = streak.totalXp + xpAwarded;

  let milestoneReached: 7 | 30 | 100 | null = null;
  if (isNewDay) {
    for (const m of MILESTONES) {
      if (newStreak === m) {
        milestoneReached = m;
        break;
      }
    }
  }

  await prisma.userStreak.update({
    where: { userId },
    data: {
      currentStreak: newStreak,
      longestStreak: newLongest,
      totalXp: newTotalXp,
      dailyXp: newDailyXp,
      lastActivityDate: isNewDay ? today : streak.lastActivityDate,
      ...(milestoneReached !== null ? { milestoneReached } : {}),
    },
  });

  // Track daysAtTop: if user is #1 by XP on a new day, increment
  if (isNewDay) {
    const higherCount = await prisma.userStreak.count({
      where: { totalXp: { gt: newTotalXp } },
    });
    if (higherCount === 0) {
      await prisma.userStreak.update({
        where: { userId },
        data: { daysAtTop: { increment: 1 } },
      });
    }
  }

  return { streakUpdated: isNewDay, newStreak, newTotalXp, newDailyXp, milestoneReached };
}

// ── Public: GET /streak ──────────────────────────────────────────────────────

export const getStreakData = async (clerkId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const streak = await getOrCreateStreak(user.id);
  const today = todayUtc();

  // Effective streak (0 if broken — more than 1 day since last activity)
  let effectiveCurrentStreak = streak.currentStreak;
  if (streak.lastActivityDate) {
    if (daysBetween(streak.lastActivityDate, today) > 1) {
      effectiveCurrentStreak = 0;
    }
  }

  // Effective daily XP resets if today hasn't had activity yet
  const effectiveDailyXp = streak.lastActivityDate === today ? streak.dailyXp : 0;

  // Week days (Mon=0 … Sun=6 for current Mon–Sun week)
  const weekDates = getWeekDates(today);
  const activities = await prisma.dailyActivity.findMany({
    where: { userId: user.id, date: { in: weekDates } },
    select: { date: true },
  });
  const activeDates = new Set(activities.map((a) => a.date));
  const weekDays = weekDates.map((d) => activeDates.has(d));

  // Capture and clear milestone
  const milestoneReached = streak.milestoneReached as 7 | 30 | 100 | null;
  if (milestoneReached !== null) {
    await prisma.userStreak.update({
      where: { userId: user.id },
      data: { milestoneReached: null },
    });
  }

  return {
    currentStreak: effectiveCurrentStreak,
    longestStreak: streak.longestStreak,
    totalXp: streak.totalXp,
    dailyXp: effectiveDailyXp,
    dailyXpGoal: streak.dailyXpGoal,
    lastActivityDate: streak.lastActivityDate,
    weekDays,
    milestoneReached,
  };
};

// ── Public: POST /streak/activity ────────────────────────────────────────────

export const recordActivity = async (
  clerkId: string,
  type: "chat_message" | "topic_complete",
  _metadata?: { topicId?: string; courseId?: string }
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const today = todayUtc();
  let xpAwarded = type === "chat_message" ? CHAT_XP : TOPIC_XP;

  // Deduplicate chat_message XP: one award per UTC day
  if (type === "chat_message") {
    const existing = await prisma.dailyActivity.findUnique({
      where: { userId_date: { userId: user.id, date: today } },
    });
    if (existing?.chatMessageAwarded) {
      xpAwarded = 0;
    }
  }

  const result = await applyXp(user.id, xpAwarded);

  // Record daily activity
  if (type === "chat_message") {
    if (xpAwarded > 0) {
      await prisma.dailyActivity.upsert({
        where: { userId_date: { userId: user.id, date: today } },
        update: { chatMessageAwarded: true },
        create: { userId: user.id, date: today, chatMessageAwarded: true },
      });
    }
  } else {
    await prisma.dailyActivity.upsert({
      where: { userId_date: { userId: user.id, date: today } },
      update: {},
      create: { userId: user.id, date: today },
    });
  }

  return {
    streakUpdated: result.streakUpdated,
    newStreak: result.newStreak,
    xpAwarded,
    totalXp: result.newTotalXp,
    dailyXp: result.newDailyXp,
    milestoneReached: result.milestoneReached,
  };
};

// ── Public: called from course.service when a topic is newly completed ───────

export const awardTopicXp = async (userId: string) => {
  const today = todayUtc();
  await applyXp(userId, TOPIC_XP);

  await prisma.dailyActivity.upsert({
    where: { userId_date: { userId, date: today } },
    update: {},
    create: { userId, date: today },
  });
};

// ── Public: GET /streak/achievements ─────────────────────────────────────────

export const getAchievements = async (clerkId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const streak = await getOrCreateStreak(user.id);

  const [topicsCompleted, coursesEnrolled] = await Promise.all([
    prisma.topicCompletion.count({ where: { userId: user.id } }),
    prisma.enrollment.count({ where: { userId: user.id } }),
  ]);

  return {
    stats: {
      longestStreak: streak.longestStreak,
      totalXp: streak.totalXp,
      topicsCompleted,
      coursesEnrolled,
      daysAtTop: streak.daysAtTop,
    },
  };
};

// ── Public: GET /streak/leaderboard ─────────────────────────────────────────

export const getLeaderboard = async (clerkId: string, limit = 10) => {
  const currentUser = await prisma.user.findUnique({ where: { clerkId } });
  if (!currentUser) throw new NotFoundError("user");

  const today = todayUtc();

  const topStreaks = await prisma.userStreak.findMany({
    orderBy: { totalXp: "desc" },
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          clerkId: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
    },
  });

  const topEntries = topStreaks.map((s, i) => {
    const effectiveStreak =
      s.lastActivityDate && daysBetween(s.lastActivityDate, today) <= 1
        ? s.currentStreak
        : 0;
    return {
      rank: i + 1,
      userId: s.user.clerkId,
      displayName: `${s.user.firstName} ${s.user.lastName.charAt(0)}.`,
      avatarUrl: s.user.avatarUrl ?? null,
      totalXp: s.totalXp,
      currentStreak: effectiveStreak,
      isCurrentUser: s.user.id === currentUser.id,
    };
  });

  const currentUserInTop = topEntries.some((e) => e.userId === clerkId);

  let currentUserEntry = null;
  if (!currentUserInTop) {
    const currentUserStreak = await prisma.userStreak.findUnique({
      where: { userId: currentUser.id },
    });

    if (currentUserStreak) {
      const rank =
        (await prisma.userStreak.count({
          where: { totalXp: { gt: currentUserStreak.totalXp } },
        })) + 1;

      const effectiveStreak =
        currentUserStreak.lastActivityDate &&
        daysBetween(currentUserStreak.lastActivityDate, today) <= 1
          ? currentUserStreak.currentStreak
          : 0;

      currentUserEntry = {
        rank,
        userId: clerkId,
        displayName: `${currentUser.firstName} ${currentUser.lastName.charAt(0)}.`,
        avatarUrl: currentUser.avatarUrl ?? null,
        totalXp: currentUserStreak.totalXp,
        currentStreak: effectiveStreak,
        isCurrentUser: true,
      };
    }
  }

  return { topEntries, currentUserEntry };
};
