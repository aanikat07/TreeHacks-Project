import { embedTexts } from "../rag/openai";
import { supabaseAdmin } from "../supabase/server";

export async function retrieveRagContext(params: {
  lessonId: string;
  query: string;
  topK: number;
}) {
  const supabase = supabaseAdmin();
  const [queryEmbedding] = await embedTexts([params.query]);

  const { data, error } = await supabase.rpc("match_rag_chunks", {
    lesson_id: params.lessonId,
    query_embedding: queryEmbedding,
    match_count: params.topK,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    source_name: row.source_name,
    source_type: row.source_type,
    content: row.content,
    score: row.similarity ?? 0,
    chunk_index: row.chunk_index,
    page: row.page,
  }));
}
