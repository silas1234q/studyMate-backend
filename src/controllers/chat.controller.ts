import { Request, Response } from "express";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";
import { getUserPreferences } from "../services/user.service";
import { buildSystemPrompt } from "../services/chat.service";
import prisma from "../config/db.config";
import { checkChatLimit, incrementChatUsage, getAiModel } from "../services/subscription.service";
import AppError from "../errors/AppError";
import { catchAsync } from "../utils/catchAsync";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_MESSAGE_LENGTH = 5000;
const MAX_MESSAGES = 50;
const ALLOWED_ROLES = new Set(["user", "assistant"]);

const VISUAL_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "show_diagram",
      description:
        "Render a Mermaid.js diagram in the chat. Use for algorithms, flowcharts, " +
        "sorting/searching, data structures, class diagrams, sequence diagrams, process flows.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Syntactically valid Mermaid.js code (max 12 nodes, concise labels).",
          },
        },
        required: ["code"],
      },
    },
  },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function sanitizeMessages(raw: unknown[]): ChatMessage[] {
  return raw
    .filter(
      (m): m is { role: string; content: string } =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as Record<string, unknown>).role === "string" &&
        ALLOWED_ROLES.has((m as Record<string, unknown>).role as string) &&
        typeof (m as Record<string, unknown>).content === "string"
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, MAX_MESSAGE_LENGTH),
    }));
}

/**
 * Verify the user is enrolled in the course that owns this topic.
 * Returns the internal DB user id, or null if not enrolled.
 */
async function verifyTopicAccess(clerkId: string, topicId: string) {
  const dbUser = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  if (!dbUser) return null;

  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: {
      course: {
        select: {
          enrollments: {
            where: { userId: dbUser.id },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!topic || topic.course.enrollments.length === 0) return null;
  return dbUser;
}

export async function handleTopicChat(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { courseTitle, topicName, messages: rawMessages, topicId, userMessage } = req.body as {
    courseTitle: string;
    topicName: string;
    messages: unknown[];
    topicId?: string;
    userMessage?: string;
  };

  if (!courseTitle || !topicName || !Array.isArray(rawMessages)) {
    res.status(400).json({ message: "courseTitle, topicName, and messages are required" });
    return;
  }

  if (typeof courseTitle !== "string" || courseTitle.length > 200) {
    res.status(400).json({ message: "Invalid courseTitle" });
    return;
  }
  if (typeof topicName !== "string" || topicName.length > 200) {
    res.status(400).json({ message: "Invalid topicName" });
    return;
  }
  if (userMessage && (typeof userMessage !== "string" || userMessage.length > MAX_MESSAGE_LENGTH)) {
    res.status(400).json({ message: `userMessage must be at most ${MAX_MESSAGE_LENGTH} characters` });
    return;
  }

  const messages = sanitizeMessages(rawMessages);

  try {
    // Check chat limit before processing
    await checkChatLimit(userId);

    // If topicId provided, verify enrollment
    let dbUser: { id: string } | null = null;
    if (topicId) {
      dbUser = await verifyTopicAccess(userId, topicId);
      if (!dbUser) {
        res.status(403).json({ message: "You do not have access to this topic" });
        return;
      }
    }

    const [prefs, aiModel] = await Promise.all([
      getUserPreferences(userId),
      getAiModel(userId),
    ]);

    // Persist the user's message and increment usage
    if (topicId && userMessage && dbUser) {
      await prisma.chatMessage.create({
        data: { userId: dbUser.id, topicId, role: "user", content: userMessage },
      });
      await incrementChatUsage(userId);
    }

    const systemPrompt = buildSystemPrompt(prefs, courseTitle, topicName);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const wantsVisual = /\b(show|draw|visuali[sz]e|diagram|depict|sketch|display|render)\b/i.test(lastUserMsg);

    let fullResponse = "";

    // ── Stream the text explanation ───────────────────────────────────────────
    const textStream = await openai.chat.completions.create({
      model: aiModel,
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    });

    for await (const chunk of textStream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ delta: content })}\n\n`);
      }
    }

    // ── If user wants a visual, force a tool call in a second pass ───────────
    if (wantsVisual) {
      const visualMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messages,
        { role: "assistant", content: fullResponse },
        {
          role: "user",
          content:
            "Now call the show_diagram tool to produce the visual you just described.",
        },
      ];

      let tcName = "";
      let tcArgs = "";

      const toolStream = await openai.chat.completions.create({
        model: aiModel,
        max_tokens: 1024,
        stream: true,
        tools: VISUAL_TOOLS,
        tool_choice: "required",
        messages: visualMessages,
      });

      for await (const chunk of toolStream) {
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) tcName = tc.function.name;
            if (tc.function?.arguments) tcArgs += tc.function.arguments;
          }
        }

        if (finishReason === "tool_calls" && tcName) {
          console.log(`[chat] tool called: ${tcName}, args: ${tcArgs}`);
          try {
            const args = JSON.parse(tcArgs) as Record<string, string>;
            let fence = "";
            if (tcName === "show_diagram" && args.code) {
              fence = `\n\`\`\`mermaid\n${args.code}\n\`\`\`\n`;
            }
            if (fence) {
              fullResponse += fence;
              res.write(`data: ${JSON.stringify({ delta: fence })}\n\n`);
            }
          } catch (e) {
            console.error("[chat] failed to parse tool args:", e, tcArgs);
          }
        }
      }
    }

    // Persist the assistant's response
    if (topicId && fullResponse && dbUser) {
      await prisma.chatMessage.create({
        data: { userId: dbUser.id, topicId, role: "assistant", content: fullResponse },
      });
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("[chat] streaming error:", err);
    if (!res.headersSent) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ success: false, type: err.type, message: err.message });
      } else {
        res.status(500).json({ message: "Failed to stream response" });
      }
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

export const getTopicChatHistory = catchAsync(async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { topicId } = req.params;
  if (!topicId || Array.isArray(topicId)) {
    res.status(400).json({ message: "Invalid topicId" });
    return;
  }

  // Verify the user is enrolled in the course that owns this topic
  const dbUser = await verifyTopicAccess(userId, topicId);
  if (!dbUser) {
    res.status(403).json({ message: "You do not have access to this topic" });
    return;
  }

  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 100));
  const cursor = req.query.cursor as string | undefined;

  const messages = await prisma.chatMessage.findMany({
    where: { userId: dbUser.id, topicId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  res.json(messages);
});
