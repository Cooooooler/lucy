declare module 'pdf-parse' {
  interface PdfParseResult {
    text?: string;
    numpages?: number;
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
