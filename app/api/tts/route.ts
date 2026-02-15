import { type NextRequest, NextResponse } from "next/server";
import { getOpenAIForServer } from "../../../lib/rag/openai";
import { applyRateLimit } from "../../../lib/security/rate-limit";

export const runtime = "nodejs";
const MAX_TTS_TEXT_LENGTH = 1200;

interface TtsRequestBody {
  text?: string;
}

export async function POST(request: NextRequest) {
  const rateLimit = applyRateLimit(request, "api:tts", {
    windowMs: 60_000,
    maxRequests: 40,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many text-to-speech requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  try {
    const body = (await request.json()) as TtsRequestBody;
    const text = body.text?.trim() || "";
    if (!text) {
      return NextResponse.json({ error: "Missing text." }, { status: 400 });
    }
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      return NextResponse.json(
        {
          error: `Text too long for speech. Maximum is ${MAX_TTS_TEXT_LENGTH} characters.`,
        },
        { status: 400 },
      );
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
