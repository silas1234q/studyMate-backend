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
  updateCourse,
  deleteCourse,
  addTopic,
  updateTopic,
  deleteTopic,
  reorderTopics,
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

export const handleUpdateCourse = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const { title, description, icon, color } = req.body as {
      title?: string;
      description?: string;
      icon?: string;
      color?: string;
    };
    const result = await updateCourse(userId, req.params.id as string, { title, description, icon, color });
    res.json(result);
  }
);

export const handleDeleteCourse = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const result = await deleteCourse(userId, req.params.id as string);
    res.json(result);
  }
);

export const handleAddTopic = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const { title } = req.body as { title?: string };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw new ValidationError("title is required");
    }
    const result = await addTopic(userId, req.params.id as string, title.trim());
    res.status(201).json(result);
  }
);

export const handleUpdateTopic = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const { title } = req.body as { title?: string };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw new ValidationError("title is required");
    }
    const result = await updateTopic(userId, req.params.id as string, req.params.topicId as string, { title: title.trim() });
    res.json(result);
  }
);

export const handleDeleteTopic = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const result = await deleteTopic(userId, req.params.id as string, req.params.topicId as string);
    res.json(result);
  }
);

export const handleReorderTopics = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const { topicIds } = req.body as { topicIds?: string[] };
    if (!Array.isArray(topicIds)) {
      throw new ValidationError("topicIds must be an array");
    }
    const result = await reorderTopics(userId, req.params.id as string, topicIds);
    res.json(result);
  }
);
