import OpenAI from "openai";
import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Message {
  role: string;
  content: string;
}

async function verifyAccess(clerkId: string, courseId: string, topicId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) throw new NotFoundError("user");

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment) throw new NotFoundError("course");

  const topic = await prisma.topic.findFirst({ where: { id: topicId, courseId } });
  if (!topic) throw new NotFoundError("topic");

  return { user, topic };
}

export const getObjectives = async (
  clerkId: string,
  courseId: string,
  topicId: string
) => {
  const { user } = await verifyAccess(clerkId, courseId, topicId);

  const objectives = await prisma.learningObjective.findMany({
    where: { topicId },
    orderBy: { order: "asc" },
    include: { covered: { where: { userId: user.id } } },
  });

  return objectives.map((obj) => ({
    id: obj.id,
    text: obj.text,
    order: obj.order,
    covered: obj.covered.length > 0,
  }));
};

export const generateObjectives = async (
  clerkId: string,
  courseId: string,
  topicId: string,
  body: { courseTitle: string; topicTitle: string }
) => {
  const { user } = await verifyAccess(clerkId, courseId, topicId);

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
        content:
          `Generate 4 to 6 specific, measurable learning objectives for the topic "${body.topicTitle}" ` +
          `within the course "${body.courseTitle}".\n\n` +
          `Each objective should be a concise statement of what a student will understand or be able to do ` +
          `after studying this topic. Start each with a verb (e.g. "Explain", "Identify", "Apply").\n\n` +
          `Return JSON: { "objectives": string[] }`,
      },
    ],
  });

  const raw = completion.choices[0].message.content ?? '{"objectives":[]}';
  let texts: string[] = [];
  try {
    const parsed = JSON.parse(raw) as { objectives?: unknown };
    if (Array.isArray(parsed.objectives)) {
      texts = (parsed.objectives as unknown[])
        .filter((t): t is string => typeof t === "string")
        .slice(0, 6);
    }
  } catch {
    texts = [];
  }

  // Replace any existing objectives for this topic
  await prisma.$transaction(async (tx) => {
    await tx.learningObjective.deleteMany({ where: { topicId } });
    for (let i = 0; i < texts.length; i++) {
      await tx.learningObjective.create({
        data: { topicId, text: texts[i], order: i },
      });
    }
  });

  const created = await prisma.learningObjective.findMany({
    where: { topicId },
    orderBy: { order: "asc" },
  });

  // Mark any existing coverages (shouldn't exist after regen, but safe)
  const coverages = await prisma.userObjectiveCoverage.findMany({
    where: { userId: user.id, objectiveId: { in: created.map((o) => o.id) } },
  });
  const coveredIds = new Set(coverages.map((c) => c.objectiveId));

  return created.map((obj) => ({
    id: obj.id,
    text: obj.text,
    order: obj.order,
    covered: coveredIds.has(obj.id),
  }));
};

export const evaluateObjectives = async (
  clerkId: string,
  courseId: string,
  topicId: string,
  body: { messages: Message[]; objectiveTexts: string[] }
) => {
  const { user } = await verifyAccess(clerkId, courseId, topicId);

  if (body.messages.length === 0 || body.objectiveTexts.length === 0) {
    return { coveredIndices: [] };
  }

  const conversation = body.messages
    .slice(-20)
    .map((m) => `${m.role === "user" ? "Student" : "AI"}: ${m.content}`)
    .join("\n");

  const objectiveList = body.objectiveTexts
    .map((text, i) => `${i}: ${text}`)
    .join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are an educational assessment assistant. Return only valid JSON.",
      },
      {
        role: "user",
        content:
          `Given the conversation below, determine which learning objectives have been meaningfully covered.\n\n` +
          `CONVERSATION:\n${conversation}\n\n` +
          `LEARNING OBJECTIVES (index: text):\n${objectiveList}\n\n` +
          `An objective is "covered" if the conversation addresses it in enough depth for a student ` +
          `to have meaningful understanding. Be generous — partial coverage counts.\n\n` +
          `Return JSON: { "coveredIndices": number[] }`,
      },
    ],
  });

  const raw = completion.choices[0].message.content ?? '{"coveredIndices":[]}';
  let coveredIndices: number[] = [];
  try {
    const parsed = JSON.parse(raw) as { coveredIndices?: unknown };
    if (Array.isArray(parsed.coveredIndices)) {
      coveredIndices = (parsed.coveredIndices as unknown[])
        .filter(
          (i): i is number =>
            typeof i === "number" && i >= 0 && i < body.objectiveTexts.length
        );
    }
  } catch {
    coveredIndices = [];
  }

  // Persist coverage to DB
  if (coveredIndices.length > 0) {
    const objectives = await prisma.learningObjective.findMany({
      where: { topicId },
      orderBy: { order: "asc" },
    });

    const toUpsert = coveredIndices
      .map((idx) => objectives[idx])
      .filter(Boolean);

    await prisma.$transaction(
      toUpsert.map((obj) =>
        prisma.userObjectiveCoverage.upsert({
          where: { userId_objectiveId: { userId: user.id, objectiveId: obj.id } },
          update: {},
          create: { userId: user.id, objectiveId: obj.id },
        })
      )
    );
  }

  return { coveredIndices };
};

export const generateQuiz = async (
  clerkId: string,
  courseId: string,
  topicId: string,
  body: {
    messages: Message[];
    objectives: string[];
    courseTitle: string;
    topicTitle: string;
  }
) => {
  await verifyAccess(clerkId, courseId, topicId);

  const conversation = body.messages
    .slice(-30)
    .map((m) => `${m.role === "user" ? "Student" : "AI"}: ${m.content}`)
    .join("\n");

  const objectivesList =
    body.objectives.length > 0
      ? body.objectives.map((o) => `- ${o}`).join("\n")
      : "(no specific objectives provided)";

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are an educational assessment designer. Return only valid JSON.",
      },
      {
        role: "user",
        content:
          `Create exactly 5 multiple-choice questions to assess understanding of "${body.topicTitle}" ` +
          `from the course "${body.courseTitle}".\n\n` +
          `LEARNING OBJECTIVES:\n${objectivesList}\n\n` +
          `CONVERSATION CONTEXT:\n${conversation}\n\n` +
          `Requirements:\n` +
          `- Each question has exactly 4 answer options\n` +
          `- One clearly correct answer per question\n` +
          `- Include a brief explanation of why the correct answer is right\n` +
          `- Questions should test the objectives and concepts from the conversation\n` +
          `- Vary difficulty: mix recall, comprehension, and application questions\n\n` +
          `Return JSON:\n` +
          `{\n` +
          `  "questions": [\n` +
          `    {\n` +
          `      "question": "string",\n` +
          `      "options": ["string", "string", "string", "string"],\n` +
          `      "correctIndex": number,\n` +
          `      "explanation": "string"\n` +
          `    }\n` +
          `  ]\n` +
          `}`,
      },
    ],
  });

  const raw = completion.choices[0].message.content ?? '{"questions":[]}';
  let questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }> = [];

  try {
    const parsed = JSON.parse(raw) as { questions?: unknown };
    if (Array.isArray(parsed.questions)) {
      questions = (parsed.questions as unknown[])
        .filter(
          (q): q is { question: string; options: string[]; correctIndex: number; explanation: string } =>
            typeof q === "object" &&
            q !== null &&
            typeof (q as Record<string, unknown>).question === "string" &&
            Array.isArray((q as Record<string, unknown>).options) &&
            typeof (q as Record<string, unknown>).correctIndex === "number"
        )
        .slice(0, 5)
        .map((q) => ({
          question: q.question,
          options: (q.options as unknown[])
            .filter((o): o is string => typeof o === "string")
            .slice(0, 4),
          correctIndex: Math.max(0, Math.min(3, q.correctIndex)),
          explanation: typeof q.explanation === "string" ? q.explanation : "",
        }));
    }
  } catch {
    questions = [];
  }

  return { questions };
};
