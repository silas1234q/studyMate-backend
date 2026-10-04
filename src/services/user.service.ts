import { clerkClient } from "@clerk/express";
import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";
import { cancelSubscription as paystackCancel } from "./paystack.service";

export const getUserPreferences = async (clerkId: string) => {
  const user = await prisma.user.findUnique({
    where: { clerkId },
    include: { preferences: true },
  });
  if (!user) throw new NotFoundError("user");
  if (!user.preferences) throw new NotFoundError("user preferences");
  return user.preferences;
};

interface OnboardingInput {
  educationLevel: number;
  studySessionDuration: number;
  learningGoal: string;
  explanationDepth: number;
  interests: string[];
  timezone?: string;
}

export const saveOnboarding = async (clerkId: string, data: OnboardingInput) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const preferences = await prisma.userPreferences.upsert({
    where: { userId: user.id },
    update: data,
    create: { userId: user.id, ...data },
  });

  await clerkClient.users.updateUserMetadata(clerkId, {
    publicMetadata: { onboarded: true },
  });

  return preferences;
};

export const updatePreferences = async (
  clerkId: string,
  data: { timezone?: string; tutorialCompletedAt?: Date },
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const prefs = await prisma.userPreferences.findUnique({ where: { userId: user.id } });
  if (!prefs) throw new NotFoundError("user preferences");

  return prisma.userPreferences.update({
    where: { userId: user.id },
    data,
  });
};

/**
 * Permanently deletes a user's account.
 *
 * The database row is removed first: every relation on User is `onDelete:
 * Cascade`, so preferences, enrollments, completions, chat history, streaks,
 * schedules, notifications, subscription and usage records all go with it.
 * Courses themselves are shared and have no owner — users are attached through
 * Enrollment — so no other user's content is affected.
 *
 * The Clerk user is removed afterwards so the identity cannot sign back in.
 * If that call fails the data is already irreversibly gone, so the failure is
 * logged rather than thrown: reporting an error would imply to the client that
 * nothing had happened. The leftover Clerk identity would simply be treated as
 * a brand-new user on next sign-in.
 */
export const deleteAccount = async (clerkId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  // Cancel billing before the record disappears. The Subscription row cascades
  // away with the user, so without this Paystack would keep charging a card for
  // an account that no longer exists, with nothing left to trace it back to.
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (
    sub?.plan === "pro" &&
    sub.status === "active" &&
    sub.paystackSubscriptionCode &&
    sub.paystackEmailToken
  ) {
    // Deliberately not swallowed: deleting here would destroy the only record
    // of what needs cancelling, leaving the user billed indefinitely. Better to
    // fail the request and let them retry.
    await paystackCancel(sub.paystackSubscriptionCode, sub.paystackEmailToken);
  }

  await prisma.user.delete({ where: { id: user.id } });

  try {
    await clerkClient.users.deleteUser(clerkId);
  } catch (err) {
    console.error(`Deleted account data for ${clerkId} but Clerk deletion failed:`, err);
  }
};
