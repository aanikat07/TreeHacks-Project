declare module "pdf-parse" {
  interface PdfParseResult {
    text?: string;
  }

  export default function pdfParse(input: Buffer): Promise<PdfParseResult>;
}

declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text?: string;
  }

  export default function pdfParse(input: Buffer): Promise<PdfParseResult>;
}
