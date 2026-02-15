import { type NextRequest, NextResponse } from "next/server";
import { ingestLectureTranscript } from "../../../lib/lecture/ingest";
import { transcribeLectureFile } from "../../../lib/lecture/transcribe";
import { applyRateLimit } from "../../../lib/security/rate-limit";
import { extractTextFromFile } from "../../../lib/upload/extract";

export const runtime = "nodejs";

const MAX_FILES = 8;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 200;
const ALLOWED_DOC_EXTENSIONS = [".txt", ".md", ".pdf", ".doc", ".docx"];
const INGEST_CONCURRENCY = 2;

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

function isDocumentType(file: File) {
  const fileName = file.name.toLowerCase();
  return ALLOWED_DOC_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

function validateFile(file: File) {
  const fileName = file.name;
  if (!fileName || fileName.length > MAX_FILENAME_LENGTH) {
    throw new Error("Invalid file name.");
  }
  if (file.size <= 0) {
    throw new Error(`File is empty: ${fileName}`);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large: ${fileName}. Max size is ${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB.`,
    );
  }
}

async function processFile(
  file: File,
  lessonId: string,
): Promise<UploadResult> {
  const fileName = file.name;
  validateFile(file);

  if (isAudioOrVideo(file)) {
    const transcriptText = await transcribeLectureFile(file);
    const chunksIndexed = await ingestLectureTranscript({
      lessonId,
      sourceName: fileName,
      transcriptText,
      sourceType: "lecture_transcript",
    });
    return { fileName, kind: "audio_video", chunksIndexed };
  }

  if (isDocumentType(file) || file.type.startsWith("text/")) {
    const extractedText = await extractTextFromFile(file);
    const chunksIndexed = await ingestLectureTranscript({
      lessonId,
      sourceName: fileName,
      transcriptText: extractedText,
      sourceType: "notes_or_textbook",
    });
    return { fileName, kind: "document", chunksIndexed };
  }

  throw new Error(
    `Unsupported file type: ${fileName}. Supported: audio/video, txt, md, pdf, doc, docx.`,
  );
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<UploadResult>,
) {
  const results: UploadResult[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await handler(items[currentIndex]);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function POST(request: NextRequest) {
  const rateLimit = applyRateLimit(request, "api:upload", {
    windowMs: 60_000,
    maxRequests: 10,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many upload requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

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
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Too many files. Maximum is ${MAX_FILES}.` },
        { status: 400 },
      );
    }

    const fileList = files as File[];
    const results = await runWithConcurrency(
      fileList,
      INGEST_CONCURRENCY,
      async (file) => processFile(file, lessonId),
    );

    return NextResponse.json({ success: true, lessonId, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    const status =
      message.includes("Unsupported file type") ||
      message.includes("File too large") ||
      message.includes("File is empty") ||
      message.includes("Invalid file name")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
