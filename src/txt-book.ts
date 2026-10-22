import type { Book } from './types';
import { sha256 } from './browser-compat';
import { parseTxt } from './txt';
export async function makeTxtBook(blob: Blob, fileName: string): Promise<Book> {
  const bytes = await blob.arrayBuffer();
  const pages = parseTxt(bytes);
  const title = fileName.replace(/\.txt$/i, '');
  const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480"><rect width="360" height="480" fill="#f4f2ed"/><text x="180" y="250" text-anchor="middle" fill="#555" font-size="40" font-family="serif">TXT</text></svg>');
  return { id: await sha256(bytes), format: 'txt', title, author: '', fileName, size: blob.size, pages: pages.length, page: 1, added: Date.now(), opened: 0, starred: false, bookmarks: [], annotations: [], cover, blob, bilingual: false };
}
