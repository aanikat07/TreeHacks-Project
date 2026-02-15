import { type NextRequest, NextResponse } from "next/server";

const DEFAULT_REALTIME_MODEL = "gpt-4o-realtime-preview";

export async function POST(request: NextRequest) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
  const sdpOffer = await request.text();
  if (!sdpOffer.trim()) {
    return NextResponse.json({ error: "Missing SDP offer." }, { status: 400 });
  }

  try {
    const sessionResponse = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          voice: "ash",
          input_audio_transcription: { model: "gpt-4o-transcribe" },
          turn_detection: null,
        }),
      },
    );

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      return NextResponse.json(
        { error: `Failed to create realtime session: ${errorText}` },
        { status: 502 },
      );
    }

    const sessionData = (await sessionResponse.json()) as {
      client_secret?: { value?: string };
    };
    const ephemeralKey = sessionData.client_secret?.value;
    if (!ephemeralKey) {
      return NextResponse.json(
        { error: "No ephemeral client secret returned by OpenAI." },
        { status: 502 },
      );
    }

    const rtcResponse = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: sdpOffer,
      },
    );

    if (!rtcResponse.ok) {
      const errorText = await rtcResponse.text();
      return NextResponse.json(
        { error: `Realtime SDP negotiation failed: ${errorText}` },
        { status: 502 },
      );
    }

    const answerSdp = await rtcResponse.text();
    return new NextResponse(answerSdp, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Realtime session error: ${message}` },
      { status: 500 },
    );
  }
}
