import { Request, Response } from "express";
import OpenAI from "openai";
import { getAuth } from "@clerk/express";
import { getUserPreferences } from "../services/user.service";
import { buildQuickChatPrompt } from "../services/chat.service";
import {
  createConversation,
  listConversations,
  getConversationMessages,
  deleteConversation,
  updateConversationTitle,
  addMessage,
  getDbUser,
} from "../services/quickchat.service";
import prisma from "../config/db.config";

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

export async function handleCreateConversation(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

  const convo = await createConversation(userId);
  res.status(201).json(convo);
}

export async function handleListConversations(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

  const conversations = await listConversations(userId);
  res.json(conversations);
}

export async function handleGetConversation(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

  const id = req.params.id as string;
  const messages = await getConversationMessages(userId, id);
  res.json(messages);
}

export async function handleDeleteConversation(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

  const id = req.params.id as string;
  await deleteConversation(userId, id);
  res.json({ success: true });
}

export async function handleQuickChat(req: Request, res: Response) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ message: "Unauthorized" }); return; }

  const { conversationId, messages, userMessage } = req.body as {
    conversationId: string;
    messages: ChatMessage[];
    userMessage: string;
  };

  if (!conversationId || !Array.isArray(messages) || !userMessage) {
    res.status(400).json({ message: "conversationId, messages, and userMessage are required" });
    return;
  }

  try {
    const dbUser = await getDbUser(userId);

    // Verify ownership
    const convo = await prisma.quickConversation.findFirst({
      where: { id: conversationId, userId: dbUser.id },
      select: { id: true, title: true },
    });
    if (!convo) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }

    // Persist user message
    await addMessage(conversationId, "user", userMessage);

    // Auto-set title from first user message if still default
    if (convo.title === "New Chat") {
      const title = userMessage.length > 50 ? userMessage.slice(0, 50) + "…" : userMessage;
      await updateConversationTitle(conversationId, title);
    }

    const prefs = await getUserPreferences(userId);
    const systemPrompt = buildQuickChatPrompt(prefs);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const wantsVisual = /\b(show|draw|visuali[sz]e|diagram|depict|sketch|display|render)\b/i.test(lastUserMsg);

    let fullResponse = "";

    const textStream = await openai.chat.completions.create({
      model: "gpt-4o",
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

    // Visual tool call if needed
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
        model: "gpt-4o",
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
            console.error("[quickchat] failed to parse tool args:", e, tcArgs);
          }
        }
      }
    }

    // Persist assistant message
    await addMessage(conversationId, "assistant", fullResponse);

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
