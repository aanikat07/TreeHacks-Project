import { embedTexts } from "../rag/openai";
import { supabaseAdmin } from "../supabase/server";

interface RetrievedChunk {
  source_name?: string;
  source_type?: string;
  content: string;
  similarity?: number;
  chunk_index?: number;
  page?: number | null;
}

export interface RagChunk {
  source_name?: string;
  source_type?: string;
  content: string;
  score: number;
  chunk_index?: number;
  page?: number | null;
}

export async function retrieveRagContext(params: {
  lessonId: string;
  query: string;
  topK: number;
}): Promise<RagChunk[]> {
  const [queryEmbedding] = await embedTexts([params.query]);
  if (!queryEmbedding) return [];

  const supabase = supabaseAdmin();
  const { data, error } = await supabase.rpc("match_rag_chunks", {
    lesson_id: params.lessonId,
    query_embedding: queryEmbedding,
    match_count: params.topK,
  });

  if (error) throw new Error(error.message);

  return ((data ?? []) as RetrievedChunk[]).map((row) => ({
    source_name: row.source_name,
    source_type: row.source_type,
    content: row.content,
    score: row.similarity ?? 0,
    chunk_index: row.chunk_index,
    page: row.page,
  }));
}
