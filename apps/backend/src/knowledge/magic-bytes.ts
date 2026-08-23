import { fileTypeFromBuffer } from 'file-type';

/** 用魔数嗅探真实文件类型（防伪装扩展名）；纯文本类（txt/md）file-type 无法识别，返回 null */
export async function detectFileType(
  buffer: Buffer,
): Promise<{ ext: string; mime: string } | null> {
  const detected = await fileTypeFromBuffer(buffer);
  return detected ? { ext: detected.ext, mime: detected.mime } : null;
}
