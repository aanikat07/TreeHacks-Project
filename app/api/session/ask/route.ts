import { NextRequest, NextResponse } from "next/server";
import { whiteboardImageToText } from "../../../../lib/whiteboard/vision";
import { retrieveRagContext } from "../../../../lib/session/retrieve";
import { generateAnimationPrompt } from "../../../../lib/session/animationPrompt";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Frontend uses courseId; DB uses lesson_id
    const lessonId: string = body.courseId ?? body.lessonId ?? "default";

    const voiceTranscript: string = body.voiceTranscript ?? "";
    const typedText: string = body.typedText ?? "";
    const whiteboardImageBase64: string | undefined = body.whiteboardImageBase64;

    // 1) Merge voice + typed into one question
    const studentQuestion =
      voiceTranscript?.trim() && typedText?.trim()
        ? `${voiceTranscript.trim()}\n(typed add-on: ${typedText.trim()})`
        : voiceTranscript?.trim() || typedText?.trim() || "";

    if (!studentQuestion) {
      return NextResponse.json({ error: "No question provided" }, { status: 400 });
    }

    // 2) Whiteboard screenshot -> extracted math text (can be empty)
    const whiteboardText = await whiteboardImageToText(whiteboardImageBase64);

    // 3) Retrieve relevant lecture chunks (RAG)
    const retrieved = await retrieveRagContext({
      lessonId,
      query: `${studentQuestion}\n\nWhiteboard:\n${whiteboardText}`,
      topK: 6,
    });

    const animationPrompt = await generateAnimationPrompt({
    studentQuestion,
    whiteboardText,
    retrievedChunks: retrieved,
    });


    return NextResponse.json({
        animationPrompt,
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Ask failed" },
      { status: 500 }
    );
  }
}
