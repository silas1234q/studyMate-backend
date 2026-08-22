import { catchAsync } from "../utils/catchAsync";
import { getAuth } from "@clerk/express";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import { saveOnboarding, getUserPreferences, updatePreferences } from "../services/user.service";

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const handleGetPreferences = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");
  const preferences = await getUserPreferences(userId);
  res.json(preferences);
});

export const onboardUser = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");

  const { educationLevel, studySessionDuration, learningGoal, explanationDepth, interests, timezone } = req.body;

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

  if (timezone !== undefined) {
    if (typeof timezone !== "string" || !isValidTimezone(timezone)) {
      error['timezone'] = "timezone must be a valid IANA timezone";
    }
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
    ...(timezone && { timezone }),
  });

  return res.status(201).json(preferences);
});

export const handleUpdatePreferences = catchAsync(async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");

  const { timezone, tutorialCompleted } = req.body;
  const data: { timezone?: string; tutorialCompletedAt?: Date } = {};

  if (timezone !== undefined) {
    if (typeof timezone !== "string" || !isValidTimezone(timezone)) {
      throw new ValidationError("timezone must be a valid IANA timezone");
    }
    data.timezone = timezone;
  }

  if (tutorialCompleted !== undefined) {
    if (typeof tutorialCompleted !== "boolean") {
      throw new ValidationError("tutorialCompleted must be a boolean");
    }
    if (tutorialCompleted) data.tutorialCompletedAt = new Date();
  }

  const preferences = await updatePreferences(userId, data);
  res.json(preferences);
});
