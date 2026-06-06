import { Request, Response } from "express";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";
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
    const [prefs, dbUser] = await Promise.all([
      getUserPreferences(userId),
      prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } }),
    ]);

    // Persist the user's message
    if (topicId && userMessage && dbUser) {
      await prisma.chatMessage.create({
        data: { userId: dbUser.id, topicId, role: "user", content: userMessage },
      });
    }

    const systemPrompt = buildSystemPrompt(prefs, courseTitle, topicName);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    });

    let fullResponse = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
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
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to stream response" });
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

export async function getTopicChatHistory(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { topicId } = req.params;

  const dbUser = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!dbUser) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const messages = await prisma.chatMessage.findMany({
    where: { userId: dbUser.id, topicId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  res.json(messages);
}
