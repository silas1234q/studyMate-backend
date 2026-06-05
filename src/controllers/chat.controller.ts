import { Request, Response } from "express";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import NotFoundError from "../errors/NotFoundError";
import { getUserPreferences } from "../services/user.service";
import { buildSystemPrompt } from "../services/chat.service";
import prisma from "../config/db.config";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function handleTopicChat(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { courseTitle, topicName, messages, topicId, userMessage } = req.body as {
    courseTitle: string;
    topicName: string;
    messages: ChatMessage[];
    topicId?: string;
    userMessage?: string;
  };

  if (!courseTitle || !topicName || !Array.isArray(messages)) {
    res.status(400).json({ message: "courseTitle, topicName, and messages are required" });
    return;
  }

  try {
    const prefs = await getUserPreferences(userId);
    const systemPrompt = buildSystemPrompt(prefs, courseTitle, topicName);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Persist the user's new message (best-effort — never blocks streaming)
    let dbUserId: string | null = null;
    if (topicId && userMessage) {
      try {
        const user = await prisma.user.findUnique({ where: { clerkId: userId } });
        if (user) {
          dbUserId = user.id;
          await prisma.chatMessage.create({
            data: { userId: user.id, topicId, role: "user", content: userMessage },
          });
        }
      } catch { /* ignore — streaming must not fail due to DB issues */ }
    }

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    });

    let fullText = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        fullText += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    // Persist the AI response
    if (dbUserId && topicId && fullText) {
      try {
        await prisma.chatMessage.create({
          data: { userId: dbUserId, topicId, role: "assistant", content: fullText },
        });
      } catch { /* ignore */ }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to stream response" });
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

export const handleGetChatHistory = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const topicId = req.params.topicId as string;

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) throw new NotFoundError("user");

    const messages = await prisma.chatMessage.findMany({
      where: { userId: user.id, topicId },
      orderBy: { createdAt: "asc" },
    });

    res.json(messages.map((m) => ({ role: m.role, content: m.content })));
  }
);
