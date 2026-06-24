import { Request, Response } from "express";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";
import { getUserPreferences } from "../services/user.service";
import { buildSystemPrompt } from "../services/chat.service";
import prisma from "../config/db.config";
import { checkChatLimit, incrementChatUsage, getAiModel } from "../services/subscription.service";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    // Check chat limit before processing
    await checkChatLimit(userId);

    const [prefs, dbUser, aiModel] = await Promise.all([
      getUserPreferences(userId),
      prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } }),
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
  if (!topicId || Array.isArray(topicId)) {
    res.status(400).json({ message: "Invalid topicId" });
    return;
  }

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
