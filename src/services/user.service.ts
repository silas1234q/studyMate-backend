import { clerkClient } from "@clerk/express";
import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";

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
