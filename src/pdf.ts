/// <reference types="vite/client" />
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import worker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { Book } from './types';
import { sha256 } from './browser-compat';
GlobalWorkerOptions.workerSrc = worker;
export function loadPdf(data: ArrayBuffer) {
  return getDocument({ data, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/' });
}
export function loadPdfCover(url: string, headers: Record<string, string>) {
  return getDocument({ url, httpHeaders: headers, withCredentials: true, disableAutoFetch: true, disableStream: true,
    rangeChunkSize: 65536, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/' });
}
export async function renderPdfCover(pdf: PDFDocumentProxy, bilingual: boolean) {
  const page = await pdf.getPage(1);
  const original = page.getViewport({ scale: 1 });
  const width = bilingual ? original.width / 2 : original.width;
  const scale = Math.min(480 / width, 1000 / original.height);
  const viewport = page.getViewport({ scale, offsetX: bilingual ? -original.width / 2 * scale : 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(viewport.height));
  try {
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally { canvas.width = 0; canvas.height = 0; }
}
export async function makeBook(blob: Blob, fileName: string, sample = false): Promise<Book> {
  const bytes = await blob.arrayBuffer();
  const id = await sha256(bytes);
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
    const cover = await renderPdfCover(pdf, bilingual);
    const now = Date.now();
    return { id, title, author, fileName, size: blob.size, pages: pdf.numPages, page: 1, added: now, opened: 0, starred: false, bookmarks: [], annotations: [], cover, blob, sample, bilingual };
  } finally { await task.destroy(); }
}
