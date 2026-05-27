import { catchAsync } from "../utils/catchAsync";
import { getAuth } from "@clerk/express";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import { saveOnboarding } from "../services/user.service";

export const onboardUser = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");

  const { educationLevel, studySessionDuration, learningGoal, explanationDepth, interests } = req.body;

  if (
    typeof educationLevel !== "number" ||
    typeof studySessionDuration !== "number" ||
    typeof explanationDepth !== "number" ||
    typeof learningGoal !== "string" ||
    !Array.isArray(interests)
  ) {
    throw new ValidationError("invalid onboarding data");
  }

  const preferences = await saveOnboarding(userId, {
    educationLevel,
    studySessionDuration,
    learningGoal,
    explanationDepth,
    interests,
  });

  return res.status(201).json(preferences);
});
