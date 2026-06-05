import { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import {
  getObjectives,
  generateObjectives,
  evaluateObjectives,
  generateQuiz,
} from "../services/objectives.service";

export const handleGetObjectives = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const courseId = req.params.courseId as string;
    const topicId = req.params.topicId as string;
    const result = await getObjectives(userId, courseId, topicId);
    res.json(result);
  }
);

export const handleGenerateObjectives = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const courseId = req.params.courseId as string;
    const topicId = req.params.topicId as string;
    const { courseTitle, topicTitle } = req.body as {
      courseTitle?: string;
      topicTitle?: string;
    };
    if (!courseTitle || !topicTitle) {
      throw new ValidationError("courseTitle and topicTitle are required");
    }
    const result = await generateObjectives(userId, courseId, topicId, {
      courseTitle,
      topicTitle,
    });
    res.json(result);
  }
);

export const handleEvaluateObjectives = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const courseId = req.params.courseId as string;
    const topicId = req.params.topicId as string;
    const { messages, objectiveTexts } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      objectiveTexts?: string[];
    };
    if (!Array.isArray(messages) || !Array.isArray(objectiveTexts)) {
      throw new ValidationError("messages and objectiveTexts must be arrays");
    }
    const result = await evaluateObjectives(userId, courseId, topicId, {
      messages,
      objectiveTexts,
    });
    res.json(result);
  }
);

export const handleGenerateQuiz = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const courseId = req.params.courseId as string;
    const topicId = req.params.topicId as string;
    const { messages, objectives, courseTitle, topicTitle } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      objectives?: string[];
      courseTitle?: string;
      topicTitle?: string;
    };
    if (
      !Array.isArray(messages) ||
      !Array.isArray(objectives) ||
      !courseTitle ||
      !topicTitle
    ) {
      throw new ValidationError(
        "messages, objectives, courseTitle, and topicTitle are required"
      );
    }
    const result = await generateQuiz(userId, courseId, topicId, {
      messages,
      objectives,
      courseTitle,
      topicTitle,
    });
    res.json(result);
  }
);
