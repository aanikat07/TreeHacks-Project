export type Chunk = {
  content: string;
  chunkIndex: number;
};

export function chunkText(text: string, maxChars = 1200, overlapChars = 200): Chunk[] {
  const clean = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!clean) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let idx = 0;

  while (start < clean.length) {
    const end = Math.min(start + maxChars, clean.length);
    const slice = clean.slice(start, end);

    chunks.push({ content: slice, chunkIndex: idx++ });

    if (end === clean.length) break;
    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}
