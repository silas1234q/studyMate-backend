import { catchAsync } from "../utils/catchAsync";
import { getAuth } from "@clerk/express";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import { saveOnboarding, getUserPreferences } from "../services/user.service";

export const handleGetPreferences = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");
  const preferences = await getUserPreferences(userId);
  res.json(preferences);
});

export const onboardUser = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");

  const { educationLevel, studySessionDuration, learningGoal, explanationDepth, interests } = req.body;

  const error: Record<string, string> = {}

  // if (
  //   typeof educationLevel !== "number" ||
  //   typeof studySessionDuration !== "number" ||
  //   typeof explanationDepth !== "number" ||
  //   typeof learningGoal !== "string" ||
  //   !Array.isArray(interests)
  // ) {
  //   throw new ValidationError("invalid onboarding data");
  // }

  if (typeof educationLevel !== "number") {
    error['educationLevel'] = "educationLevel must be a number";
  }

  if (typeof studySessionDuration !== "number") {
    error['studySessionDuration'] = "studySessionDuration must be a number";
  }

  if (typeof explanationDepth !== "number") {
    error['explanationDepth'] = "explanationDepth must be a number";
  }


  if (typeof learningGoal !== "string") {
    error['learningGoal'] = "learningGoal must be a string";
  } else if (learningGoal.length > 500) {
    error['learningGoal'] = "learningGoal must be at most 500 characters";
  }

  if (!Array.isArray(interests)) {
    error['interests'] = "interests must be an array";
  } else if (interests.length > 20) {
    error['interests'] = "interests must have at most 20 items";
  } else if (interests.some((i: unknown) => typeof i !== "string" || (i as string).length > 50)) {
    error['interests'] = "each interest must be a string of at most 50 characters";
  }

  if (Object.keys(error).length > 0) {
    throw new ValidationError(`invalid onboarding data ${error}`);
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
