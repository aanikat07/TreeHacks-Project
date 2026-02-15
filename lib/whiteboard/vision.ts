import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function whiteboardImageToText(whiteboardBase64?: string): Promise<string> {
  if (!whiteboardBase64) return "";

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are reading a math whiteboard. Extract equations, symbols, and describe what the student is attempting. Be concise.",
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

  return resp.choices[0]?.message?.content?.trim() ?? "";
}
