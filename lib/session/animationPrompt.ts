import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type RetrievedChunk = {
  source_name?: string;
  content: string;
  chunk_index?: number;
  page?: number | null;
};

function compactContext(chunks: RetrievedChunk[], maxChars = 1500) {
  const parts = chunks.slice(0, 4).map((c, i) => {
    const src = c.source_name ?? "Lecture";
    const loc =
      c.page != null
        ? `page ${c.page}`
        : c.chunk_index != null
        ? `chunk ${c.chunk_index}`
        : "";
    return `[${i + 1}] ${src}${loc ? ` (${loc})` : ""}\n${c.content}`;
  });

  const joined = parts.join("\n\n");
  return joined.length > maxChars ? joined.slice(0, maxChars) + "..." : joined;
}

export async function generateAnimationPrompt(params: {
  studentQuestion: string;
  whiteboardText: string;
  retrievedChunks: RetrievedChunk[];
}): Promise<string> {
  const { studentQuestion, whiteboardText, retrievedChunks } = params;

  const context = retrievedChunks.length > 0 ? compactContext(retrievedChunks) : "NONE";

  const system = `
You generate concise animation-ready prompts for an educational animation engine.

Return ONE structured string with the following sections exactly:

STUDENT QUESTION:
WHITEBOARD:
LECTURE GROUNDING:
ANIMATION PLAN:

Rules:
- Be concise, around 50 words.
- Do not output JSON.
- Do not add commentary.
- ANIMATION PLAN should contain 2-3 numbered steps.
- Each step must describe what to visually show and what to say in one sentence.
- Prefer lecture grounding over general knowledge.
- If lecture grounding is NONE, say so and use general knowledge carefully.
`.trim();

  const user = `
Student question:
${studentQuestion}

Whiteboard extract:
${whiteboardText?.trim() ? whiteboardText.trim() : "NONE"}

Retrieved lecture context:
${context}
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return resp.choices[0]?.message?.content?.trim() ?? "";
}
