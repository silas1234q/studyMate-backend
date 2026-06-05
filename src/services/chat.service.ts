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
- Break down complex ideas into digestible parts
- For the very first message in a conversation, open with a brief engaging intro to the topic, using one of their interests as an analogy if applicable
- Ask follow-up questions to check understanding when appropriate

Math formatting:
- Always write mathematical expressions in LaTeX using $...$ for inline math (e.g. $x^2 + 1$) and $$...$$ on its own line for display/block equations
- Never use plain parentheses like \\( ... \\) or \\[ ... \\] — use only $ and $$ delimiters`;
}
