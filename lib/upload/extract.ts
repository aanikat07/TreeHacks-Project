export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const bytes = await file.arrayBuffer();
  const buf = Buffer.from(bytes);

  // Plain text
  if (name.endsWith(".txt") || file.type.startsWith("text/")) {
    return buf.toString("utf-8");
  }
``
// PDF
if (name.endsWith(".pdf") || file.type === "application/pdf") {
  const mod: any = await import("pdf-parse");
  const pdfParse = mod.default ?? mod; // works whether it exports default or module itself
  const parsed = await pdfParse(buf);
  return parsed.text ?? "";
}



  // Fallback: treat as text if possible
  // (For doc/docx you would add mammoth, but keep MVP minimal)
  const asText = buf.toString("utf-8");
  if (asText.trim().length > 0) return asText;

  throw new Error(`Unsupported file type for extraction: ${file.name}`);
}
