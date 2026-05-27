import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";

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

  return preferences;
};
