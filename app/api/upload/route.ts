import { type NextRequest, NextResponse } from "next/server";
import { ingestLectureTranscript } from "../../../lib/lecture/ingest";
import { transcribeLectureFile } from "../../../lib/lecture/transcribe";
import { extractTextFromFile } from "../../../lib/upload/extract";

export const runtime = "nodejs";

interface UploadResult {
  fileName: string;
  kind: "audio_video" | "document";
  chunksIndexed: number;
}

function isAudioOrVideo(file: File) {
  const fileName = file.name.toLowerCase();
  const mime = file.type || "";
  return (
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    fileName.endsWith(".mp3") ||
    fileName.endsWith(".wav") ||
    fileName.endsWith(".m4a") ||
    fileName.endsWith(".mp4") ||
    fileName.endsWith(".mov") ||
    fileName.endsWith(".webm")
  );
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const lessonId = (
      formData.get("lessonId") ??
      formData.get("courseId") ??
      `lesson-${Date.now()}`
    ).toString();
    const files = formData.getAll("files");

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files uploaded." },
        { status: 400 },
      );
    }

    const results: UploadResult[] = [];

    for (const entry of files) {
      const file = entry as File;
      const fileName = file.name;

      if (isAudioOrVideo(file)) {
        const transcriptText = await transcribeLectureFile(file);
        const chunksIndexed = await ingestLectureTranscript({
          lessonId,
          sourceName: fileName,
          transcriptText,
          sourceType: "lecture_transcript",
        });
        results.push({ fileName, kind: "audio_video", chunksIndexed });
      } else {
        const extractedText = await extractTextFromFile(file);
        const chunksIndexed = await ingestLectureTranscript({
          lessonId,
          sourceName: fileName,
          transcriptText: extractedText,
          sourceType: "notes_or_textbook",
        });
        results.push({ fileName, kind: "document", chunksIndexed });
      }
    }

    return NextResponse.json({ success: true, lessonId, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
