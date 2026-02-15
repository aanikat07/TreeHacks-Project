import { NextRequest, NextResponse } from "next/server";
import { ingestLectureTranscript } from "../../../lib/lecture/ingest";
import { transcribeLectureFile } from "../../../lib/lecture/transcribe";
import { extractTextFromFile } from "../../../lib/upload/extract";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const lessonId = (form.get("lessonId") ?? form.get("courseId") ?? "default").toString();
    const files = form.getAll("files");

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const results: Array<{ fileName: string; kind: string; chunksIndexed: number }> = [];

    for (const f of files) {
      const file = f as File;
      const fileName = file.name;
      const mime = file.type || "";
      const lower = fileName.toLowerCase();

      const isAudioVideo =
        mime.startsWith("audio/") ||
        mime.startsWith("video/") ||
        lower.endsWith(".mp3") ||
        lower.endsWith(".wav") ||
        lower.endsWith(".m4a") ||
        lower.endsWith(".mp4") ||
        lower.endsWith(".mov") ||
        lower.endsWith(".webm");

      if (isAudioVideo) {
        const transcriptText = await transcribeLectureFile(file);
        const chunksIndexed = await ingestLectureTranscript({
          lessonId,
          sourceName: fileName,
          transcriptText,
          sourceType: "lecture_transcript",
        });
        results.push({ fileName, kind: "audio_video", chunksIndexed });
        continue;
      }

      const extractedText = await extractTextFromFile(file);
      const chunksIndexed = await ingestLectureTranscript({
        lessonId,
        sourceName: fileName,
        transcriptText: extractedText,
        sourceType: "notes_or_textbook",
      });

      results.push({ fileName, kind: "document", chunksIndexed });
    }

    return NextResponse.json({ success: true, lessonId, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Upload failed" }, { status: 500 });
  }
}
