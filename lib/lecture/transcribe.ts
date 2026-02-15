import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function transcribeLectureFile(file: File): Promise<string> {
  const resp = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
  return resp.text ?? "";
}
