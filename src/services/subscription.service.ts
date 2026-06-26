import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";
import SubscriptionError from "../errors/SubscriptionError";

export const PLAN_LIMITS = {
  free: {
    maxCourses: 1,
    chatMessagesPerDay: 5,
    quizzesPerDay: 1,
    quickChat: false,
    illustrations: false,
    aiModel: "gpt-4o-mini" as const,
  },
  pro: {
    maxCourses: Infinity,
    chatMessagesPerDay: Infinity,
    quizzesPerDay: Infinity,
    quickChat: true,
    illustrations: true,
    aiModel: "gpt-4o" as const,
  },
} as const;

type PlanType = keyof typeof PLAN_LIMITS;

async function getDbUser(clerkId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) throw new NotFoundError("user");
  return user;
}

// First N users get 3 months of Pro for free
const EARLY_ADOPTER_LIMIT = 10;
// All new users get a 3-day Pro trial
const TRIAL_DAYS = 3;

export async function getUserSubscription(userId: string) {
  let sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub) {
    // Check if this user qualifies for early adopter bonus (first 20 users)
    const totalSubscriptions = await prisma.subscription.count();
    const isEarlyAdopter = totalSubscriptions < EARLY_ADOPTER_LIMIT;

    const now = new Date();
    if (isEarlyAdopter) {
      // First 20 users: 3 months free Pro
      const trialEnd = new Date(now);
      trialEnd.setMonth(trialEnd.getMonth() + 3);
      sub = await prisma.subscription.create({
        data: {
          userId,
          plan: "pro",
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
        },
      });
    } else {
      // All other new users: 3-day free trial of Pro
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
      sub = await prisma.subscription.create({
        data: {
          userId,
          plan: "pro",
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
        },
      });
    }
  }

  // Check if a non-Paystack trial/promo has expired → downgrade to free
  if (
    sub.plan === "pro" &&
    !sub.paystackSubscriptionCode &&
    sub.currentPeriodEnd &&
    new Date() > sub.currentPeriodEnd
  ) {
    sub = await prisma.subscription.update({
      where: { id: sub.id },
      data: { plan: "free", status: "expired" },
    });
  }

  return sub;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function getUsageToday(userId: string) {
  const date = todayStr();
  let usage = await prisma.usageTracker.findUnique({
    where: { userId_date: { userId, date } },
  });
  if (!usage) {
    usage = await prisma.usageTracker.create({
      data: { userId, date, chatMessages: 0, quizzes: 0 },
    });
  }
  return usage;
}

export async function incrementUsage(userId: string, field: "chatMessages" | "quizzes") {
  const date = todayStr();
  await prisma.usageTracker.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, [field]: 1 },
    update: { [field]: { increment: 1 } },
  });
}

export async function checkCourseLimit(clerkId: string) {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id);
  const limits = PLAN_LIMITS[sub.plan as PlanType] ?? PLAN_LIMITS.free;
  if (limits.maxCourses === Infinity) return;

  const count = await prisma.enrollment.count({ where: { userId: user.id } });
  if (count >= limits.maxCourses) {
    throw new SubscriptionError(
      `Free plan is limited to ${limits.maxCourses} courses. Upgrade to Pro for unlimited courses.`
    );
  }
}

export async function checkChatLimit(clerkId: string) {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id);
  const limits = PLAN_LIMITS[sub.plan as PlanType] ?? PLAN_LIMITS.free;
  if (limits.chatMessagesPerDay === Infinity) return;

  const usage = await getUsageToday(user.id);
  if (usage.chatMessages >= limits.chatMessagesPerDay) {
    throw new SubscriptionError(
      `Free plan is limited to ${limits.chatMessagesPerDay} chat messages per day. Upgrade to Pro for unlimited messages.`
    );
  }
}

export async function checkQuizLimit(clerkId: string) {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id);
  const limits = PLAN_LIMITS[sub.plan as PlanType] ?? PLAN_LIMITS.free;
  if (limits.quizzesPerDay === Infinity) return;

  const usage = await getUsageToday(user.id);
  if (usage.quizzes >= limits.quizzesPerDay) {
    throw new SubscriptionError(
      `Free plan is limited to ${limits.quizzesPerDay} quiz per day. Upgrade to Pro for unlimited quizzes.`
    );
  }
}

export async function checkFeatureAccess(clerkId: string, feature: "quickChat" | "illustrations") {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id);
  const limits = PLAN_LIMITS[sub.plan as PlanType] ?? PLAN_LIMITS.free;
  if (!limits[feature]) {
    const label = feature === "quickChat" ? "Quick Chat" : "AI Illustrations";
    throw new SubscriptionError(`${label} is a Pro feature. Upgrade to Pro to access it.`);
  }
}

export async function getSubscriptionStatus(clerkId: string) {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id);
  const plan = (sub.plan as PlanType) ?? "free";
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const usage = await getUsageToday(user.id);
  const courseCount = await prisma.enrollment.count({ where: { userId: user.id } });

  // Determine if this is a trial (Pro without Paystack subscription and not a GHS one-time payment)
  const isGhsOneTime = sub.plan === "pro" && sub.currency === "GHS" && !sub.paystackSubscriptionCode && !!sub.paystackCustomerCode;
  const isTrial = sub.plan === "pro" && !sub.paystackSubscriptionCode && !isGhsOneTime && !!sub.currentPeriodEnd;

  // Early adopter = trial period longer than 30 days (3 months vs 3 days)
  const isEarlyAdopter =
    isTrial &&
    !!sub.currentPeriodStart &&
    !!sub.currentPeriodEnd &&
    sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime() > 30 * 24 * 60 * 60 * 1000;

  // One-time payment: GHS Pro user without Paystack subscription (not a trial)
  const isOneTimePayment = isGhsOneTime && !isTrial;

  // Renewal due in days for active one-time payment users
  let renewalDueInDays: number | null = null;
  if (isOneTimePayment && sub.status === "active" && sub.currentPeriodEnd) {
    const msLeft = sub.currentPeriodEnd.getTime() - Date.now();
    renewalDueInDays = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  }

  return {
    plan: sub.plan,
    status: sub.status,
    interval: sub.interval,
    currency: sub.currency,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelledAt: sub.cancelledAt,
    hasPaystackSubscription: !!sub.paystackSubscriptionCode,
    isTrial,
    isEarlyAdopter,
    isOneTimePayment,
    renewalDueInDays,
    limits: {
      maxCourses: limits.maxCourses === Infinity ? null : limits.maxCourses,
      chatMessagesPerDay: limits.chatMessagesPerDay === Infinity ? null : limits.chatMessagesPerDay,
      quizzesPerDay: limits.quizzesPerDay === Infinity ? null : limits.quizzesPerDay,
      quickChat: limits.quickChat,
      illustrations: limits.illustrations,
    },
    usage: {
      coursesUsed: courseCount,
      chatMessagesToday: usage.chatMessages,
      quizzesToday: usage.quizzes,
    },
  };
}

export async function getAiModel(clerkId: string): Promise<string> {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id);
  const limits = PLAN_LIMITS[sub.plan as PlanType] ?? PLAN_LIMITS.free;
  return limits.aiModel;
}

export async function incrementChatUsage(clerkId: string) {
  const user = await getDbUser(clerkId);
  await incrementUsage(user.id, "chatMessages");
}

export async function incrementQuizUsage(clerkId: string) {
  const user = await getDbUser(clerkId);
  await incrementUsage(user.id, "quizzes");
}
