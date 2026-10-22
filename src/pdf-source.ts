import type { Book } from './types';
import { sha256 } from './browser-compat';

// Transient ownership handoff, never persisted with the Book. PDF.js transfers
// this buffer to its worker; the reader clears it immediately after handoff.
export type PdfSource = { bytes?: ArrayBuffer };

export async function readCachedPdf(book: Book): Promise<ArrayBuffer | null> {
  try {
    if (!(book.blob instanceof Blob) || book.blob.size !== book.size) return null;
    const bytes = await book.blob.arrayBuffer();
    return await sha256(bytes) === book.id ? bytes : null;
  } catch (error) {
    console.warn('PDF cache read failed', error);
    return null;
  }
}
