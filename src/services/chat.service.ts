import type OpenAI from "openai";
interface Preferences {
  educationLevel: number;
  explanationDepth: number;
  learningGoal: string;
  interests: string[];
}

const EDUCATION_LABELS: Record<number, string> = {
  1: "High school",
  2: "Undergraduate (early)",
  3: "Undergraduate (advanced)",
  4: "Graduate / Postgraduate",
  5: "Professional / Researcher",
};

const DEPTH_LABELS: Record<number, string> = {
  1: "Simple overviews — avoid jargon",
  2: "Balanced — some detail with clear explanations",
  3: "In-depth — technical detail welcome",
};

export function buildQuickChatPrompt(prefs: Preferences): string {
  const educationLabel = EDUCATION_LABELS[prefs.educationLevel] ?? `Level ${prefs.educationLevel}`;
  const depthLabel = DEPTH_LABELS[prefs.explanationDepth] ?? `Depth ${prefs.explanationDepth}`;
  const interestsList = prefs.interests.length > 0 ? prefs.interests.join(", ") : "general topics";

  return `You are a knowledgeable AI tutor. The student can ask about any subject.

Student profile:
- Interests: ${interestsList}
- Education level: ${educationLabel}
- Preferred explanation depth: ${depthLabel}
- Learning goal: ${prefs.learningGoal}

Teaching style:
- Use analogies and real-world examples drawn from the student's interests whenever possible
- Match explanation depth to their preference
- Keep a conversational, encouraging tone
- Break down complex ideas into digestible parts and explain it to them like they are a ${educationLabel} student and break the explanation step by step if the topic is complex and dont let them lose track when reading long explanations, keep the coversation engaging and interactive by asking them questions and encouraging them to ask questions as well
-use simple language and avoid jargon unless the student has indicated they prefer in-depth explanations, in which case you can use more technical language but always explain any complex terms you use
- Ask follow-up questions to check understanding when appropriate

Math formatting:
- Always write mathematical expressions in LaTeX using $...$ for inline math (e.g. $x^2 + 1$) and $$...$$ on its own line for display/block equations
- Never use plain parentheses like \\( ... \\) or \\[ ... \\] — use only $ and $$ delimiters

When an explanation benefits from a visual — or the student explicitly asks to see one — call the show_diagram tool to render a Mermaid.js diagram.`;
}

export function buildSystemPrompt(
  prefs: Preferences,
  courseTitle: string,
  topicName: string
): string {
  const educationLabel = EDUCATION_LABELS[prefs.educationLevel] ?? `Level ${prefs.educationLevel}`;
  const depthLabel = DEPTH_LABELS[prefs.explanationDepth] ?? `Depth ${prefs.explanationDepth}`;
  const interestsList = prefs.interests.length > 0 ? prefs.interests.join(", ") : "general topics";

  return `You are a personalized AI tutor for the course "${courseTitle}".
The student is currently studying the topic: "${topicName}".

Student profile:
- Interests: ${interestsList}
- Education level: ${educationLabel}
- Preferred explanation depth: ${depthLabel}
- Learning goal: ${prefs.learningGoal}

Teaching style:
- Use analogies and real-world examples drawn from the student's interests whenever possible
- Match explanation depth to their preference
- Keep a conversational, encouraging tone
- Break down complex ideas into digestible parts and explain it to them like they are a ${educationLabel} student and break the explanation step by step if the topic is complex and dont let them lose track when reading long explanations, keep the coversation engaging and interactive by asking them questions and encouraging them to ask questions as well 
-use simple language and avoid jargon unless the student has indicated they prefer in-depth explanations, in which case you can use more technical language but always explain any complex terms you use
- For the very first message in a conversation, open with a brief engaging intro to the topic, using one of their interests as an analogy if applicable
- Ask follow-up questions to check understanding when appropriate

Math formatting:
- Always write mathematical expressions in LaTeX using $...$ for inline math (e.g. $x^2 + 1$) and $$...$$ on its own line for display/block equations
- Never use plain parentheses like \\( ... \\) or \\[ ... \\] — use only $ and $$ delimiters

When an explanation benefits from a visual — or the student explicitly asks to see one — call the show_diagram tool to render a Mermaid.js diagram.`;
}

/**
 * The student's uploaded syllabus / notes, framed as authoritative. Appended to
 * every generation prompt so the AI teaches their institution's material rather
 * than a generic version of the subject.
 */
export function buildMaterialSection(material: string | null): string {
  if (!material) return "";

  return `\n\nTHE STUDENT'S OWN COURSE MATERIAL (authoritative):\n${material}\n\n` +
    `Rules for using this material:\n` +
    `- Teach strictly within the scope of this material. It defines what their institution requires.\n` +
    `- Match its terminology, notation and depth, even where you would normally phrase things differently.\n` +
    `- If they ask about something outside it, answer briefly, then say plainly that it is outside their course material.\n` +
    `- Never introduce topics absent from this material as if they were required.`;
}

export type Attachment = {
  url: string;
  name?: string | null;
  type?: string | null;
  /** pre-extracted text, for formats the model can't read directly */
  text?: string | null;
};

/**
 * Attaches a file to the LAST user message only. Sending it with every historical
 * turn would re-bill vision/file tokens on each request.
 *
 * Images and PDFs go to the model as native parts; every other format was already
 * read at upload time, so its text is injected inline instead.
 */
export function attachToLastUserMessage(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  attachments: Attachment[] | Attachment | null,
  promptText: string
): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [...messages];

  // A single attachment is accepted as well as a list: the web client still
  // sends one, and normalising here keeps both callers on one code path.
  const list = (
    Array.isArray(attachments) ? attachments : attachments ? [attachments] : []
  ).filter((a) => !!a?.url);
  if (list.length === 0) return out;

  const lastUserIdx = out.map((m) => m.role).lastIndexOf("user");
  if (lastUserIdx === -1) return out;

  const originalText = messages[lastUserIdx]?.content || promptText;

  const images = list.filter((a) => (a.type ?? "").startsWith("image/"));
  // Everything else — PDF included — was read at upload time. Injecting the
  // extracted text avoids re-downloading and re-encoding the file on every send.
  const documentText = list
    .filter((a) => !(a.type ?? "").startsWith("image/") && a.text)
    .map((d) => `\n\n[Attached file: ${d.name ?? "document"}]\n${(d.text ?? "").slice(0, 6000)}`)
    .join("");

  if (images.length > 0) {
    out[lastUserIdx] = {
      role: "user",
      content: [
        { type: "text", text: `${originalText}${documentText}` },
        ...images.map((img) => ({
          type: "image_url" as const,
          image_url: { url: img.url },
        })),
      ],
    };
    return out;
  }

  if (documentText) {
    out[lastUserIdx] = { role: "user", content: `${originalText}${documentText}` };
  }
  return out;
}

/** Cap on attachments per message, mirrored by the mobile picker. */
export const MAX_ATTACHMENTS = 5;

type StoredAttachments = {
  attachmentUrls: string[];
  attachmentNames: string[];
  attachmentTypes: string[];
};

/**
 * Adds the pre-array `attachmentUrl/Name/Type` fields back onto a message,
 * populated from the first attachment.
 *
 * The web client reads those singular fields and has not been changed, so the
 * history endpoints keep serving them alongside the arrays. Remove this once
 * every client reads `attachments`.
 */
export function withLegacyAttachment<T extends StoredAttachments>(message: T) {
  const attachments = message.attachmentUrls.map((url, i) => ({
    url,
    name: message.attachmentNames[i] || null,
    type: message.attachmentTypes[i] || null,
  }));

  return {
    ...message,
    attachments,
    attachmentUrl: attachments[0]?.url ?? null,
    attachmentName: attachments[0]?.name ?? null,
    attachmentType: attachments[0]?.type ?? null,
  };
}
