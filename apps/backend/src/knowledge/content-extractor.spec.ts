import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdf-parse', () => ({
  default: vi.fn(() => Promise.resolve({ text: 'pdf text', numpages: 1 })),
}));
vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(() => Promise.resolve({ value: 'docx text' })),
  },
}));

import mammoth from 'mammoth';
import PdfParse from 'pdf-parse';
import { extractContent } from './content-extractor.js';

describe('extractContent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('txt 直接读 utf8', async () => {
    expect(await extractContent(Buffer.from('你好'), '.txt')).toBe('你好');
  });

  it('md 直接读 utf8', async () => {
    expect(await extractContent(Buffer.from('# hi'), '.md')).toBe('# hi');
  });

  it('pdf 走 pdf-parse', async () => {
    expect(await extractContent(Buffer.from('%PDF'), '.pdf')).toBe('pdf text');
    expect(PdfParse).toHaveBeenCalled();
  });

  it('docx 走 mammoth', async () => {
    expect(await extractContent(Buffer.from('PK'), '.docx')).toBe('docx text');
    expect(mammoth.extractRawText).toHaveBeenCalled();
  });
});
