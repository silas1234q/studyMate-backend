import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import {
  createCourse,
  generateTopicsPreview,
  getUserCourses,
  getCourseById,
  completeTopic,
  type GeneratedPreview,
} from "../services/course.service";

export const handleGetCourses = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const courses = await getUserCourses(userId);
    res.json(courses);
  }
);

export const handleGetCourse = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const course = await getCourseById(userId, req.params.id as string);
    res.json(course);
  }
);

export const handleGenerateTopics = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const { title } = req.body as { title?: string };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw new ValidationError("title is required");
    }
    const preview = await generateTopicsPreview(title.trim());
    res.json(preview);
  }
);

export const handleCreateCourse = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const { title, description, icon, color, topics } = req.body as {
      title?: string;
      description?: string;
      icon?: string;
      color?: string;
      topics?: string[];
    };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw new ValidationError("title is required");
    }
    const preview: GeneratedPreview | undefined =
      description && icon && color && Array.isArray(topics) && topics.length > 0
        ? { description, icon, color, topics }
        : undefined;
    const course = await createCourse(userId, title.trim(), preview);
    res.status(201).json(course);
  }
);

export const handleCompleteTopic = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const result = await completeTopic(userId, req.params.id as string, req.params.topicId as string);
    res.json(result);
  }
);
