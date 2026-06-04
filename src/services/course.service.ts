import OpenAI from "openai";
import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GeneratedPreview {
  description: string;
  icon: string;
  color: string;
  topics: string[];
}

const FALLBACK_COLORS = [
  "#6541F0", "#EC4899", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6",
];

async function generateCourseStructure(title: string): Promise<GeneratedPreview> {
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
  };
}

export const generateTopicsPreview = async (title: string): Promise<GeneratedPreview> => {
  return generateCourseStructure(title);
};

export const createCourse = async (
  clerkId: string,
  title: string,
  preview?: GeneratedPreview
) => {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const generated = preview ?? await generateCourseStructure(title);

  const course = await prisma.$transaction(async (tx) => {
    const newCourse = await tx.course.create({
      data: {
        title,
        description: generated.description,
        icon: generated.icon,
        color: generated.color,
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

  return {
    id: course.id,
    title: course.title,
    description: course.description,
    color: course.color,
    icon: course.icon,
    topics: course.topics.map((t) => ({ id: t.id, title: t.title, order: t.order, completed: false })),
    totalTopics: course.topics.length,
    topicsCompleted: 0,
    progressPercent: 0,
  };
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
      })
    )
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
    topics,
    totalTopics: total,
    topicsCompleted,
    progressPercent: total > 0 ? Math.round((topicsCompleted / total) * 100) : 0,
  };
};

export const completeTopic = async (
  clerkId: string,
  courseId: string,
  topicId: string
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

  await prisma.topicCompletion.upsert({
    where: { userId_topicId: { userId: user.id, topicId } },
    update: {},
    create: { userId: user.id, topicId },
  });

  return { success: true };
};
