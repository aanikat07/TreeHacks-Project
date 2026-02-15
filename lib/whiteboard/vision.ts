import { getOpenAIForServer } from "../rag/openai";

export async function whiteboardImageToText(
  whiteboardBase64?: string,
): Promise<string> {
  if (!whiteboardBase64) return "";

  const openai = getOpenAIForServer();
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are reading a math whiteboard. Extract equations, symbols, and summarize the student's intent concisely.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract what is on this whiteboard." },
          { type: "image_url", image_url: { url: whiteboardBase64 } },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}
