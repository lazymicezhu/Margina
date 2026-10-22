// Shared by browser and Worker: fixed pagination keeps synced page numbers stable.
export const TXT_MAX_BYTES = 10 * 1024 * 1024;
export function parseTxt(bytes: ArrayBuffer): string[] {
  if (!bytes.byteLength || bytes.byteLength > TXT_MAX_BYTES) throw new Error('TXT 须为非空文件且不超过 10 MB');
  const data = new Uint8Array(bytes);
  let text: string;
  if (data[0] === 0xff && data[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(data);
  else if (data[0] === 0xfe && data[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(data);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { text = new TextDecoder('gb18030', { fatal: true }).decode(data); }
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim() || /[\x00-\x08\x0B\x0E-\x1F]/.test(text)) throw new Error('不是可阅读的 TXT 文本');
  const pages: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 1200, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline > start + 600) end = newline + 1;
      else if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
    }
    pages.push(text.slice(start, end)); start = end;
  }
  return pages;
}
