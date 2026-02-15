import { getOpenAIForServer } from "../rag/openai";
import type { RagChunk } from "./retrieve";

function compactContext(chunks: RagChunk[], maxChars = 1800) {
  const parts = chunks.slice(0, 4).map((chunk, index) => {
    const source = chunk.source_name ?? "Lecture";
    const location =
      chunk.page != null
        ? `page ${chunk.page}`
        : chunk.chunk_index != null
          ? `chunk ${chunk.chunk_index}`
          : "";
    return `[${index + 1}] ${source}${location ? ` (${location})` : ""}\n${chunk.content}`;
  });

  const joined = parts.join("\n\n");
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}...` : joined;
}

export async function generateAnimationPrompt(params: {
  studentQuestion: string;
  whiteboardText: string;
  retrievedChunks: RagChunk[];
}): Promise<string> {
  const openai = getOpenAIForServer();
  const context =
    params.retrievedChunks.length > 0
      ? compactContext(params.retrievedChunks)
      : "NONE";

  const system = `You generate concise, animation-ready prompts for a Manim code generator.

Return exactly one structured prompt with these sections:
STUDENT QUESTION:
WHITEBOARD:
LECTURE GROUNDING:
ANIMATION PLAN:

Rules:
- Keep it concise, around 70-120 words.
- Do not output JSON.
- Do not include commentary outside the sections.
- ANIMATION PLAN must contain numbered steps.
- Each step should say what to show visually and what to explain.
- Every visual element should be spaced out (e.g. no overlapping objects)
- Prefer retrieved lecture grounding over general knowledge.`;

  const user = `Student question:
${params.studentQuestion}

Whiteboard extract:
${params.whiteboardText.trim() || "NONE"}

Retrieved lecture context:
${context}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}
