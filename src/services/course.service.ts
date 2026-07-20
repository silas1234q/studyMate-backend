import OpenAI from "openai";
import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";
import { awardTopicXp } from "./streak.service";
import { checkCourseLimit } from "./subscription.service";
import {
  createNotification,
  checkAndCreateAchievementNotifications,
} from "./notification.service";
import { NotificationType } from "../types/notification.types";
import { COURSE_CATEGORIES } from "../constants/courseCategories";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GeneratedPreview {
  description: string;
  icon: string;
  color: string;
  topics: string[];
  category?: string;
  imageUrl?: string | null;
}

const FALLBACK_COLORS = [
  "#6541F0",
  "#EC4899",
  "#F59E0B",
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
];

async function generateCourseStructure(
  title: string,
): Promise<GeneratedPreview> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a curriculum designer. Return only valid JSON.",
      },
      {
        role: "user",
        content: `Create a structured course outline for: "${title}"\n\nReturn JSON with:\n- description: string (1-2 sentence course overview)\n- icon: string (single relevant emoji)\n- color: string (vibrant hex color, e.g. "#6541F0")\n- topics: string[] (8-12 topic titles in logical learning order)\n- category: string | null (classify into ONE of: ${COURSE_CATEGORIES.join(", ")}. Use null if none fit.)`,
      },
    ],
  });

  const raw = completion.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<GeneratedPreview>;

  const category =
    parsed.category && (COURSE_CATEGORIES as readonly string[]).includes(parsed.category)
      ? parsed.category
      : undefined;

  return {
    description: parsed.description ?? `A comprehensive course on ${title}.`,
    icon: parsed.icon ?? "📚",
    color:
      parsed.color && /^#[0-9A-Fa-f]{6}$/.test(parsed.color)
        ? parsed.color
        : FALLBACK_COLORS[Math.floor(Math.random() * FALLBACK_COLORS.length)],
    topics:
      Array.isArray(parsed.topics) && parsed.topics.length > 0
        ? parsed.topics
        : ["Introduction", "Core Concepts", "Practice & Review"],
    category,
  };
}

export const generateTopicsPreview = async (
  title: string,
): Promise<GeneratedPreview> => {
  const preview = await generateCourseStructure(title);

  let imageUrl: string | null = null;
  if (preview.category) {
    const images = await prisma.categoryImage.findMany({
      where: { category: preview.category },
    });
    if (images.length > 0) {
      imageUrl = images[Math.floor(Math.random() * images.length)].imageUrl;
    }
  }

  return { ...preview, imageUrl };
};

export const createCourse = async (
  clerkId: string,
  title: string,
  preview?: GeneratedPreview,
) => {
  await checkCourseLimit(clerkId);

  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const generated = preview ?? (await generateCourseStructure(title));

  let imageUrl: string | null = preview?.imageUrl ?? null;
  if (!imageUrl && generated.category) {
    const images = await prisma.categoryImage.findMany({
      where: { category: generated.category },
    });
    if (images.length > 0) {
      imageUrl = images[Math.floor(Math.random() * images.length)].imageUrl;
    }
  }

  const course = await prisma.$transaction(async (tx) => {
    const newCourse = await tx.course.create({
      data: {
        title,
        description: generated.description,
        icon: generated.icon,
        color: generated.color,
        imageUrl,
        topics: {
          create: generated.topics.map((t, i) => ({ title: t, order: i })),
        },
      },
      include: { topics: { orderBy: { order: "asc" } } },
    });

    await tx.enrollment.create({
      data: { userId: user.id, courseId: newCourse.id },
    });

    return newCourse;
  });

  checkAndCreateAchievementNotifications(user.id).catch(() => {});

  const result = {
    id: course.id,
    title: course.title,
    description: course.description,
    color: course.color,
    icon: course.icon,
    imageUrl: course.imageUrl,
    topics: course.topics.map((t) => ({
      id: t.id,
      title: t.title,
      order: t.order,
      completed: false,
    })),
    totalTopics: course.topics.length,
    topicsCompleted: 0,
    progressPercent: 0,
  };

  return result;
};

export const getUserCourses = async (clerkId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollments = await prisma.enrollment.findMany({
    where: { userId: user.id },
    include: {
      course: {
        include: { topics: { orderBy: { order: "asc" } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Single query to get all completion counts instead of N+1
  const allTopicIds = enrollments.flatMap(({ course }) => course.topics.map((t) => t.id));
  const completions = await prisma.topicCompletion.findMany({
    where: { userId: user.id, topicId: { in: allTopicIds } },
    select: { topicId: true },
  });
  const completedTopicIds = new Set(completions.map((c) => c.topicId));

  return enrollments.map(({ course }) => {
    const total = course.topics.length;
    const completed = course.topics.filter((t) => completedTopicIds.has(t.id)).length;
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      color: course.color,
      icon: course.icon,
      imageUrl: course.imageUrl,
      topicTitles: course.topics.map((t) => t.title),
      totalTopics: total,
      topicsCompleted: completed,
      progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  });
};

export const getCourseById = async (clerkId: string, courseId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { topics: { orderBy: { order: "asc" } } },
  });
  if (!course) throw new NotFoundError("course");

  const completions = await prisma.topicCompletion.findMany({
    where: { userId: user.id, topicId: { in: course.topics.map((t) => t.id) } },
  });
  const completedIds = new Set(completions.map((c) => c.topicId));

  const topics = course.topics.map((t) => ({
    id: t.id,
    title: t.title,
    order: t.order,
    overview: t.overview,
    completed: completedIds.has(t.id),
  }));

  const topicsCompleted = topics.filter((t) => t.completed).length;
  const total = topics.length;

  return {
    id: course.id,
    title: course.title,
    description: course.description,
    color: course.color,
    icon: course.icon,
    imageUrl: course.imageUrl,
    topics,
    totalTopics: total,
    topicsCompleted,
    progressPercent:
      total > 0 ? Math.round((topicsCompleted / total) * 100) : 0,
  };
};

export const updateCourse = async (
  clerkId: string,
  courseId: string,
  data: { title?: string; description?: string; icon?: string; color?: string },
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  const course = await prisma.course.update({
    where: { id: courseId },
    data,
    include: { topics: { orderBy: { order: "asc" } } },
  });

  const completions = await prisma.topicCompletion.findMany({
    where: { userId: user.id, topicId: { in: course.topics.map((t) => t.id) } },
  });
  const completedIds = new Set(completions.map((c) => c.topicId));
  const topics = course.topics.map((t) => ({
    id: t.id,
    title: t.title,
    order: t.order,
    completed: completedIds.has(t.id),
  }));
  const topicsCompleted = topics.filter((t) => t.completed).length;
  const total = topics.length;

  return {
    id: course.id,
    title: course.title,
    description: course.description,
    color: course.color,
    icon: course.icon,
    imageUrl: course.imageUrl,
    topics,
    totalTopics: total,
    topicsCompleted,
    progressPercent: total > 0 ? Math.round((topicsCompleted / total) * 100) : 0,
  };
};

export const deleteCourse = async (clerkId: string, courseId: string) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  await prisma.enrollment.delete({
    where: { userId_courseId: { userId: user.id, courseId } },
  });

  // If no other users are enrolled, delete the orphaned course
  const remaining = await prisma.enrollment.count({ where: { courseId } });
  if (remaining === 0) {
    await prisma.course.delete({ where: { id: courseId } });
  }

  return { success: true };
};

export const addTopic = async (
  clerkId: string,
  courseId: string,
  title: string,
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  const count = await prisma.topic.count({ where: { courseId } });
  const topic = await prisma.topic.create({
    data: { courseId, title, order: count },
  });

  return { id: topic.id, title: topic.title, order: topic.order, completed: false };
};

export const updateTopic = async (
  clerkId: string,
  courseId: string,
  topicId: string,
  data: { title: string },
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  const topic = await prisma.topic.findFirst({ where: { id: topicId, courseId } });
  if (!topic) throw new NotFoundError("topic");

  const updated = await prisma.topic.update({ where: { id: topicId }, data });
  return { id: updated.id, title: updated.title, order: updated.order };
};

export const deleteTopic = async (
  clerkId: string,
  courseId: string,
  topicId: string,
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  const topic = await prisma.topic.findFirst({ where: { id: topicId, courseId } });
  if (!topic) throw new NotFoundError("topic");

  await prisma.topic.delete({ where: { id: topicId } });
  return { success: true };
};

export const reorderTopics = async (
  clerkId: string,
  courseId: string,
  topicIds: string[],
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  // Two-step raw SQL to avoid @@unique([courseId, order]) violation:
  // 1. Move all orders to negative (unique, no collisions)
  // 2. Set final values (all start negative, targets are unique non-negative)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!topicIds.every((id) => uuidRegex.test(id))) {
    throw new Error("Invalid topic ID format");
  }

  const ids = topicIds.map((id) => `'${id}'`).join(", ");
  const cases = topicIds
    .map((id, i) => `WHEN "id" = '${id}' THEN ${i}`)
    .join(" ");

  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `UPDATE "Topic" SET "order" = -("order" + 1) WHERE "id" IN (${ids})`,
    ),
    prisma.$executeRawUnsafe(
      `UPDATE "Topic" SET "order" = CASE ${cases} END WHERE "id" IN (${ids})`,
    ),
  ]);

  return { success: true };
};

export const saveTopicOverview = async (
  clerkId: string,
  courseId: string,
  topicId: string,
  overview: string,
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  const topic = await prisma.topic.findFirst({ where: { id: topicId, courseId } });
  if (!topic) throw new NotFoundError("topic");

  await prisma.topic.update({
    where: { id: topicId },
    data: { overview },
  });

  return { success: true };
};

export const completeTopic = async (
  clerkId: string,
  courseId: string,
  topicId: string,
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  const topic = await prisma.topic.findFirst({
    where: { id: topicId, courseId },
  });
  if (!topic) throw new NotFoundError("topic");

  const existing = await prisma.topicCompletion.findUnique({
    where: { userId_topicId: { userId: user.id, topicId } },
  });

  if (!existing) {
    await prisma.topicCompletion.create({ data: { userId: user.id, topicId } });
    await awardTopicXp(user.id);

    // Fire-and-forget: topic completed notification
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true, topics: { select: { id: true } } } });
    if (course) {
      createNotification(
        user.id,
        NotificationType.TOPIC_COMPLETED,
        "Topic Completed",
        `You completed "${topic.title}" in ${course.title}`,
        { courseId, topicId, topicTitle: topic.title, courseTitle: course.title },
      ).catch(() => {});

      // Check if all topics in course are completed
      const allTopicIds = course.topics.map((t) => t.id);
      const completedCount = await prisma.topicCompletion.count({
        where: { userId: user.id, topicId: { in: allTopicIds } },
      });
      if (completedCount === allTopicIds.length) {
        createNotification(
          user.id,
          NotificationType.COURSE_COMPLETED,
          "Course Completed",
          `You completed all topics in ${course.title}!`,
          { courseId, courseTitle: course.title },
        ).catch(() => {});
      }
    }

    checkAndCreateAchievementNotifications(user.id).catch(() => {});
  }

  return { success: true };
};
