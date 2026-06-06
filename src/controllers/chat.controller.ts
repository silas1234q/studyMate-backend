import { Request, Response } from "express";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";
import { getUserPreferences } from "../services/user.service";
import { buildSystemPrompt } from "../services/chat.service";
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

  const { courseTitle, topicName, messages } = req.body as {
    courseTitle: string;
    topicName: string;
    messages: ChatMessage[];
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

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
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
