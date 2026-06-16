import OpenAI from "openai";
import prisma from "../config/db.config";
import cloudinary from "../config/cloudinary.config";
import NotFoundError from "../errors/NotFoundError";
import { awardTopicXp } from "./streak.service";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GeneratedPreview {
  description: string;
  icon: string;
  color: string;
  topics: string[];
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

async function generateCourseImage(title: string): Promise<string | null> {
  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `A stunning, hyper-detailed digital artwork representing the subject of '${title}'. Cinematic lighting, rich colors, sharp focus, photorealistic or concept-art style. No text, no letters, no UI elements.`,
    });

    if (!response.data || response.data.length === 0) return null;

    const b64 = response.data[0].b64_json;
    if (!b64) return null;

    const tempUrl = `data:image/png;base64,${b64}`;

    const result = await cloudinary.uploader.upload(tempUrl, {
      folder: "studymate-courses",
      resource_type: "image",
    });

    console.log("Cloudinary upload result:", result);

    return result.secure_url;
  } catch (err) {
    console.error("generateCourseImage error:", err);
    return null;
  }
}

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
        content: `Create a structured course outline for: "${title}"\n\nReturn JSON with:\n- description: string (1-2 sentence course overview)\n- icon: string (single relevant emoji)\n- color: string (vibrant hex color, e.g. "#6541F0")\n- topics: string[] (8-12 topic titles in logical learning order)`,
      },
    ],
  });

  const raw = completion.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<GeneratedPreview>;

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
    imageUrl: null,
  };
}

export const generateTopicsPreview = async (
  title: string,
): Promise<GeneratedPreview> => {
  return generateCourseStructure(title);
};

export const createCourse = async (
  clerkId: string,
  title: string,
  preview?: GeneratedPreview,
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const generated = preview ?? (await generateCourseStructure(title));

  const course = await prisma.$transaction(async (tx) => {
    const newCourse = await tx.course.create({
      data: {
        title,
        description: generated.description,
        icon: generated.icon,
        color: generated.color,
        imageUrl: generated.imageUrl ?? null,
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

  const result = {
    id: course.id,
    title: course.title,
    description: course.description,
    color: course.color,
    icon: course.icon,
    imageUrl: course.imageUrl ?? null,
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

  // Fire-and-forget: generate course image in background
  const courseId = course.id;
  generateCourseImage(title).then(async (url) => {
    if (url) {
      await prisma.course.update({ where: { id: courseId }, data: { imageUrl: url } });
      console.log("Background image gen completed for course:", courseId);
    }
  }).catch((err) => console.error("Background image gen failed:", err));

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

  const completionCounts = await Promise.all(
    enrollments.map(({ course }) =>
      prisma.topicCompletion.count({
        where: {
          userId: user.id,
          topicId: { in: course.topics.map((t) => t.id) },
        },
      }),
    ),
  );

  return enrollments.map(({ course }, i) => {
    const total = course.topics.length;
    const completed = completionCounts[i];
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      color: course.color,
      icon: course.icon,
      imageUrl: course.imageUrl ?? null,
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
    imageUrl: course.imageUrl ?? null,
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
    imageUrl: course.imageUrl ?? null,
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
  }

  return { success: true };
};
