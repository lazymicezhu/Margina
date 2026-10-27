export const COVER_MAX_BYTES = 300 * 1024;
export type Cover = { mime: 'image/jpeg'; page: 1; crop: 'zh' | 'full'; pdfSha256: string; width: number; height: number; data: string };

// Check the actual JPEG frame, not just the client-supplied MIME/dimensions.
export function jpegSize(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes.length > COVER_MAX_BYTES || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('封面须为小于 300 KB 的 JPEG 图片');
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) break;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([192, 193, 194].includes(marker) && length >= 8) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (width < 1 || height < 1 || width > 640 || height > 1200) throw new Error('封面尺寸超出范围');
      return { width, height };
    }
    offset += length;
  }
  throw new Error('封面 JPEG 格式不正确');
}
export function validateCover(value: unknown, pdfSha256: string): Cover {
  const c = value as Cover;
  if (!c || c.mime !== 'image/jpeg' || c.page !== 1 || !['zh', 'full'].includes(c.crop) || c.pdfSha256 !== pdfSha256 || !/^[a-f0-9]{64}$/.test(pdfSha256) || typeof c.data !== 'string' || c.data.length > Math.ceil(COVER_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(c.data) || c.data.length % 4) throw new Error('阅读包封面格式或 PDF 绑定不正确');
  const bytes = Uint8Array.from(atob(c.data), char => char.charCodeAt(0));
  const size = jpegSize(bytes);
  if (size.width !== c.width || size.height !== c.height) throw new Error('封面尺寸与图片不一致');
  return c;
}
export const coverDataUrl = (cover: Cover) => `data:${cover.mime};base64,${cover.data}`;
