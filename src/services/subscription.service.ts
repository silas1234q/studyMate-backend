import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";
import SubscriptionError from "../errors/SubscriptionError";

export const PLAN_LIMITS = {
  free: {
    maxCourses: 1,
    chatMessagesPerDay: 5,
    quizzesPerDay: 1,
    quickChat: false,
    courseMaterials: false,
    chatImages: false,
    illustrations: false,
    aiModel: "gpt-4o-mini" as const,
  },
  pro: {
    maxCourses: Infinity,
    chatMessagesPerDay: Infinity,
    quizzesPerDay: Infinity,
    quickChat: true,
    courseMaterials: true,
    chatImages: true,
    illustrations: true,
    aiModel: "gpt-4o" as const,
  },
} as const;

export type PlanType = keyof typeof PLAN_LIMITS;

async function getDbUser(clerkId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) throw new NotFoundError("user");
  return user;
}

// First N users get 3 months of Pro for free
const EARLY_ADOPTER_LIMIT = 10;
// All new users get a 3-day Pro trial
const TRIAL_DAYS = 3;

const RC_GRACE_MS = 6 * 60 * 60 * 1000; // late-renewal buffer for mobile subscribers

export async function getUserSubscription(userId: string) {
  let sub = await prisma.subscription.findUnique({ where: { userId } });

  if (!sub) {
    // First 20 subscriptions get 3 months of Pro, everyone else gets TRIAL_DAYS
    const total = await prisma.subscription.count();
    const now = new Date();
    const trialEnd = new Date(now);
    if (total < EARLY_ADOPTER_LIMIT) {
      trialEnd.setMonth(trialEnd.getMonth() + 3);
    } else {
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
    }

    // upsert so two concurrent first requests (or a webhook that got there first)
    // return the existing row instead of throwing a unique-constraint error
    sub = await prisma.subscription.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        plan: "pro",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
      },
    });
  }

  // Expire Pro rows that have no Paystack subscription behind them:
  // trials, GHS one-time payments and RevenueCat subscribers.
  const graceMs = sub.billingProvider === "revenuecat" ? RC_GRACE_MS : 0;
  const expired =
    sub.plan === "pro" &&
    !sub.paystackSubscriptionCode &&
    !!sub.currentPeriodEnd &&
    Date.now() > sub.currentPeriodEnd.getTime() + graceMs;

  if (expired) {
    // Optimistic update: only downgrade if the row still has the period end we
    // read. If a RENEWAL webhook extended it in the meantime, count is 0 and
    // we keep the webhook's data instead of overwriting it.
    const { count } = await prisma.subscription.updateMany({
      where: { id: sub.id, plan: "pro", currentPeriodEnd: sub.currentPeriodEnd },
      data: { plan: "free", status: "expired" },
    });

    if (count === 0) {
      sub = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    } else {
      sub = { ...sub, plan: "free", status: "expired" };
    }
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
  const sub = await getUserSubscription(userId);
   const limit = (PLAN_LIMITS[sub.plan as PlanType] ?? PLAN_LIMITS.free).chatMessagesPerDay;
  const date = todayStr();

  const usage = await prisma.usageTracker.upsert({
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

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getSubscriptionStatus(clerkId: string) {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id); // already downgrades expired non-Paystack subs

  const [usage, courseCount] = await Promise.all([
    getUsageToday(user.id),
    prisma.enrollment.count({ where: { userId: user.id } }),
  ]);

  // Unknown plan strings (e.g. a stray "premium") fall back to free limits, but loudly
  const plan: PlanType = sub.plan in PLAN_LIMITS ? (sub.plan as PlanType) : "free";
  if (plan !== sub.plan) {
    console.warn(`[subscription] unknown plan "${sub.plan}" for user ${user.id}, using free limits`);
  }
  const limits = PLAN_LIMITS[plan];

  const isPro = sub.plan === "pro";
  const isPaystack = sub.billingProvider === "paystack"; // default for trials too
  const hasPaystackSub = !!sub.paystackSubscriptionCode;

  // GHS one-time payment: Paystack, Pro, no recurring subscription, has a customer code
  const isOneTimePayment =
    isPaystack && isPro && sub.currency === "GHS" && !hasPaystackSub && !!sub.paystackCustomerCode;

  // Trial / promo: Pro row created by getUserSubscription (no payment of any kind)
  const isTrial =
    isPaystack && isPro && !hasPaystackSub && !isOneTimePayment && !!sub.currentPeriodEnd;

  // Early adopter = promo longer than 30 days (3 months vs 3 days)
  const isEarlyAdopter =
    isTrial &&
    !!sub.currentPeriodStart &&
    !!sub.currentPeriodEnd &&
    sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime() > 30 * DAY_MS;

  let renewalDueInDays: number | null = null;
  if (isOneTimePayment && sub.status === "active" && sub.currentPeriodEnd) {
    renewalDueInDays = Math.max(
      0,
      Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / DAY_MS),
    );
  }

  return {
    plan: sub.plan,
    status: sub.status,
    interval: sub.interval,
    currency: sub.currency,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelledAt: sub.cancelledAt,

    // provider info so the client can pick the right manage/cancel UI
    billingProvider: sub.billingProvider,
    store: sub.store,
    willRenew: sub.willRenew,

    hasPaystackSubscription: hasPaystackSub,
    isTrial,
    isEarlyAdopter,
    isOneTimePayment,
    renewalDueInDays,

    limits: {
      maxCourses: limits.maxCourses === Infinity ? null : limits.maxCourses,
      chatMessagesPerDay: limits.chatMessagesPerDay === Infinity ? null : limits.chatMessagesPerDay,
      quizzesPerDay: limits.quizzesPerDay === Infinity ? null : limits.quizzesPerDay,
      quickChat: limits.quickChat,
      courseMaterials: limits.courseMaterials,
      chatImages: limits.chatImages,
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

export async function checkMaterialAccess(clerkId: string) {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id);
  const limits = PLAN_LIMITS[sub.plan as PlanType] ?? PLAN_LIMITS.free;
  if (limits.courseMaterials) return;

  throw new SubscriptionError(
    "Uploading course material is a Pro feature. Upgrade to attach your notes and slides."
  );
}

export async function checkChatImageAccess(clerkId: string) {
  const user = await getDbUser(clerkId);
  const sub = await getUserSubscription(user.id);
  const limits = PLAN_LIMITS[sub.plan as PlanType] ?? PLAN_LIMITS.free;
  if (limits.chatImages) return;

  throw new SubscriptionError(
    "Sending images in chat is a Pro feature. Upgrade to ask about photos and diagrams."
  );
}
