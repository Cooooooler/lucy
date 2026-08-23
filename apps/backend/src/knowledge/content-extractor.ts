import mammoth from 'mammoth';
import PdfParse from 'pdf-parse';

/** 支持的文档扩展名白名单（含点） */
export const SUPPORTED_DOCUMENT_EXTS = ['.txt', '.md', '.pdf', '.docx'];

/** 按扩展名提取纯文本：txt/md 直接读 utf8，pdf/docx 走解析库 */
export async function extractContent(
  buffer: Buffer,
  ext: string,
): Promise<string> {
  switch (ext) {
    case '.pdf': {
      // pdf-parse 类型由 src/knowledge/pdf-parse.d.ts 声明
      const { text } = await PdfParse(buffer);
      return text ?? '';
    }
    case '.docx': {
      const { value } = await mammoth.extractRawText({ buffer });
      return value ?? '';
    }
    default:
      return buffer.toString('utf8');
  }
}
