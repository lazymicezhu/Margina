/// <reference types="vite/client" />
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Book } from './types';
GlobalWorkerOptions.workerSrc = worker;
export function loadPdf(data: ArrayBuffer) {
  return getDocument({ data, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/' });
}
export async function makeBook(blob: Blob, fileName: string, sample = false): Promise<Book> {
  const bytes = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const task = loadPdf(bytes);
  try {
    const pdf = await task.promise;
    let title = fileName.replace(/\.pdf$/i, '');
    let author = '';
    let bilingual = false;
    try {
      const { info } = await pdf.getMetadata();
      const metadata = info as { Title?: string; Author?: string; Creator?: string };
      if (metadata.Title?.trim() && !/^(untitled|microsoft|document)/i.test(metadata.Title)) title = metadata.Title.trim();
      author = metadata.Author?.trim() || '';
      bilingual = /BabelDOC.*reviewed translation/i.test(metadata.Creator || '') || /中英对照/.test(metadata.Title || '');
    } catch { /* A PDF can be readable without metadata. */ }
    const page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const scale = 360 / (bilingual ? original.width / 2 : original.width);
    const viewport = page.getViewport({ scale, offsetX: bilingual ? -original.width / 2 * scale : 0 });
    const canvas = document.createElement('canvas');
    canvas.width = 360; canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const now = Date.now();
    return { id, title, author, fileName, size: blob.size, pages: pdf.numPages, page: 1, added: now, opened: 0, starred: false, bookmarks: [], annotations: [], cover: canvas.toDataURL('image/webp', 0.85), blob, sample, bilingual };
  } finally { await task.destroy(); }
}
