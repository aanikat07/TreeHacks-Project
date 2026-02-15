import { getOpenAIForServer } from "../rag/openai";

export async function transcribeLectureFile(file: File): Promise<string> {
  const openai = getOpenAIForServer();
  const response = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
  return response.text ?? "";
}
