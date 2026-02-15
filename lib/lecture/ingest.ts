import { chunkText } from "../rag/chunking";
import { embedTexts } from "../rag/openai";
import { supabaseAdmin } from "../supabase/server";
import { hashText } from "../rag/hash"; // adjust name if your hash export differs

type IngestLectureArgs = {
  lessonId: string;        // use this instead of courseId in your calls
  sourceName: string;      // lecture title
  transcriptText: string;
  sourceType?: string;     // default "lecture_transcript"
};

function chunkToString(c: any): string {
  return (c?.text ?? c?.content ?? c?.chunk ?? "").toString();
}

export async function ingestLectureTranscript(args: IngestLectureArgs): Promise<number> {
  const {
    lessonId,
    sourceName,
    transcriptText,
    sourceType = "lecture_transcript",
  } = args;

  if (!transcriptText?.trim()) throw new Error("Transcript text is empty.");

  const supabase = supabaseAdmin();

  // 1) Chunk (returns Chunk[])
  const chunks = chunkText(transcriptText);
  if (!chunks?.length) throw new Error("Chunking produced no chunks.");

  // 2) Convert to string[]
  const contents = chunks.map(chunkToString).filter((t) => t.trim().length > 0);
  if (!contents.length) throw new Error("All chunks were empty after conversion.");

  // 3) Embed
  const embeddings = await embedTexts(contents);
  if (embeddings.length !== contents.length) {
    throw new Error("Embedding count does not match chunk count.");
  }

  // 4) Prepare rows for YOUR schema
  const rows = contents.map((content, i) => ({
    lesson_id: lessonId,
    source_type: sourceType,
    source_name: sourceName,
    page: null,
    chunk_index: i,
    content,
    content_hash: hashText(content), // if your hash fn is named differently, change it here
    embedding: embeddings[i],
  }));

  const { error } = await supabase.from("rag_chunks").insert(rows);
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);

  return rows.length;
}
