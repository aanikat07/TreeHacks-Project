import { chunkText } from "../rag/chunking";
import { hashText } from "../rag/hash";
import { embedTexts } from "../rag/openai";
import { supabaseAdmin } from "../supabase/server";

interface IngestLectureArgs {
  lessonId: string;
  sourceName: string;
  transcriptText: string;
  sourceType?: string;
}

export async function ingestLectureTranscript(
  args: IngestLectureArgs,
): Promise<number> {
  const {
    lessonId,
    sourceName,
    transcriptText,
    sourceType = "lecture_transcript",
  } = args;

  if (!transcriptText.trim()) {
    throw new Error("Transcript text is empty.");
  }

  const chunks = chunkText(transcriptText);
  const contents = chunks.map((chunk) => chunk.content).filter(Boolean);

  if (contents.length === 0) {
    throw new Error("Chunking produced no usable content.");
  }

  const embeddings = await embedTexts(contents);
  if (embeddings.length !== contents.length) {
    throw new Error("Embedding count does not match chunk count.");
  }

  const rows = contents.map((content, index) => ({
    lesson_id: lessonId,
    source_type: sourceType,
    source_name: sourceName,
    page: null as number | null,
    chunk_index: index,
    content,
    content_hash: hashText(content),
    embedding: embeddings[index],
  }));

  const supabase = supabaseAdmin();
  const { error } = await supabase.from("rag_chunks").insert(rows);
  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return rows.length;
}
