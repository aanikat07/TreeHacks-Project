export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  if (name.endsWith(".txt") || file.type.startsWith("text/")) {
    return buffer.toString("utf-8");
  }

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const mod = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as {
      default?: (input: Buffer) => Promise<{ text?: string }>;
    };
    const pdfParse = mod.default;
    if (!pdfParse) {
      throw new Error("PDF parser failed to load.");
    }
    const parsed = await pdfParse(buffer);
    return parsed.text ?? "";
  }

  const asText = buffer.toString("utf-8");
  if (asText.trim().length > 0) return asText;

  throw new Error(`Unsupported file type for extraction: ${file.name}`);
}
