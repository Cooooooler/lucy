import { describe, expect, it } from 'vitest';
import { detectFileType } from './magic-bytes.js';

describe('detectFileType', () => {
  it('识别 PDF 魔数', async () => {
    const r = await detectFileType(Buffer.from('%PDF-1.4\n...'));
    expect(r).toEqual({ ext: 'pdf', mime: 'application/pdf' });
  });

  it('纯文本返回 null（无魔数）', async () => {
    expect(await detectFileType(Buffer.from('just plain text'))).toBeNull();
  });
});
