import { type NextRequest, NextResponse } from "next/server";
import { getOpenAIForServer } from "../../../lib/rag/openai";

export const runtime = "nodejs";

interface TtsRequestBody {
  text?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TtsRequestBody;
    const text = body.text?.trim() || "";
    if (!text) {
      return NextResponse.json({ error: "Missing text." }, { status: 400 });
    }

    const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    const voice = process.env.OPENAI_TTS_VOICE || "marin";

    const openai = getOpenAIForServer();
    const audioResponse = await openai.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: "mp3",
    });

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Text-to-speech failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
