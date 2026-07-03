import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";
import ValidationError from "../errors/ValidationError";

function snapTo15Min(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const snapped = Math.round(m / 15) * 15;
  const finalH = snapped === 60 ? (h + 1) % 24 : h;
  const finalM = snapped === 60 ? 0 : snapped;
  return `${String(finalH).padStart(2, "0")}:${String(finalM).padStart(2, "0")}`;
}

function validateDaysOfWeek(days: number[]) {
  if (!Array.isArray(days) || days.length === 0) {
    throw new ValidationError("daysOfWeek must be a non-empty array");
  }
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new ValidationError("each day must be an integer 0-6 (Sun-Sat)");
    }
  }
}

function validateTime(time: string) {
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) {
    throw new ValidationError("time must be in HH:mm format");
  }
  const [h, m] = time.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    throw new ValidationError("time must be a valid HH:mm value");
  }
}

export const createSchedule = async (
  clerkId: string,
  data: { courseId: string; daysOfWeek: number[]; time: string },
) => {
  validateDaysOfWeek(data.daysOfWeek);
  validateTime(data.time);

  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: data.courseId } },
  });
  if (!enrollment) throw new NotFoundError("enrollment");

  const snappedTime = snapTo15Min(data.time);

  return prisma.studySchedule.create({
    data: {
      enrollmentId: enrollment.id,
      userId: user.id,
      daysOfWeek: [...new Set(data.daysOfWeek)],
      time: snappedTime,
      isActive: true,
    },
    include: {
      enrollment: { include: { course: { select: { title: true, color: true, icon: true } } } },
    },
  });
};

export const updateSchedule = async (
  clerkId: string,
  scheduleId: string,
  data: { daysOfWeek?: number[]; time?: string; isActive?: boolean },
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const schedule = await prisma.studySchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule || schedule.userId !== user.id) throw new NotFoundError("schedule");

  const updateData: Record<string, unknown> = {};

  if (data.daysOfWeek !== undefined) {
    validateDaysOfWeek(data.daysOfWeek);
    updateData.daysOfWeek = [...new Set(data.daysOfWeek)];
  }
  if (data.time !== undefined) {
    validateTime(data.time);
    updateData.time = snapTo15Min(data.time);
  }
  if (data.isActive !== undefined) {
    updateData.isActive = data.isActive;
  }

  return prisma.studySchedule.update({
    where: { id: scheduleId },
    data: updateData,
    include: {
      enrollment: { include: { course: { select: { title: true, color: true, icon: true } } } },
    },
  });
};

export const getScheduleForCourse = async (clerkId: string, courseId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) return null;

  return prisma.studySchedule.findUnique({
    where: { enrollmentId: enrollment.id },
    include: {
      enrollment: { include: { course: { select: { title: true, color: true, icon: true } } } },
    },
  });
};

export const getAllSchedules = async (clerkId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  return prisma.studySchedule.findMany({
    where: { userId: user.id },
    include: {
      enrollment: { include: { course: { select: { title: true, color: true, icon: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const deleteSchedule = async (clerkId: string, scheduleId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const schedule = await prisma.studySchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule || schedule.userId !== user.id) throw new NotFoundError("schedule");

  return prisma.studySchedule.delete({ where: { id: scheduleId } });
};
