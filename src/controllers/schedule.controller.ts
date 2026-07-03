import { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import {
  createSchedule,
  updateSchedule,
  getScheduleForCourse,
  getAllSchedules,
  deleteSchedule,
} from "../services/schedule.service";

export const handleCreateSchedule = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const { courseId, daysOfWeek, time } = req.body;
    const schedule = await createSchedule(userId, { courseId, daysOfWeek, time });
    res.status(201).json(schedule);
  },
);

export const handleGetAllSchedules = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const schedules = await getAllSchedules(userId);
    res.json(schedules);
  },
);

export const handleGetScheduleForCourse = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const schedule = await getScheduleForCourse(userId, req.params.courseId as string);
    res.json(schedule);
  },
);

export const handleUpdateSchedule = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const { daysOfWeek, time, isActive } = req.body;
    const schedule = await updateSchedule(userId, req.params.id as string, { daysOfWeek, time, isActive });
    res.json(schedule);
  },
);

export const handleDeleteSchedule = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    await deleteSchedule(userId, req.params.id as string);
    res.json({ success: true });
  },
);
