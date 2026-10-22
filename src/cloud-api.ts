import type { Paper, Session } from './cloud-types';
import type { Book } from './types';
import { validateBundle } from './bundle';
import { listBooks, putBook, patchBook, setting } from './storage';
import { makeBook } from './pdf';
import { sha256 } from './browser-compat';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError('服务连接失败，请刷新页面或重新登录。', response.status);
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error || '请求失败，请重试', response.status, body);
  return body;
}
export const session = () => api<Session>('/api/session');
export const catalog = (query = '', offset = 0) => api<{ papers: Paper[]; more: boolean }>(`/api/catalog?q=${encodeURIComponent(query)}&offset=${offset}`);
export const getPaper = (id: string) => api<Paper>(`/api/papers/${id}`);
export const jsonOptions = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function uploadPdf(book: Book, user: string) {
  return api<{ paper: Paper; duplicate?: boolean }>(`/api/private/papers/${book.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'X-Public-Upload': 'confirmed', 'X-Margina-User': user,
      'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ title: book.title.slice(0, 500), author: book.author.slice(0, 300), fileName: book.fileName.slice(0, 255), pages: book.pages, bilingual: book.bilingual })) }, body: book.blob,
  });
}
export async function uploadBundle(file: File, user: string) {
  if (file.size > 20 * 1024 * 1024) throw new Error('阅读包不能超过 20 MB');
  const bundle = validateBundle(JSON.parse(await file.text()));
  const options = jsonOptions('PUT', bundle);
  return api<{ paper: Paper }>(`/api/private/papers/${bundle.pdfSha256}/bundle`, { ...options, headers: { ...options.headers, 'X-Margina-User': user, 'X-Public-Upload': 'confirmed' } });
}
export async function cachedPdfValid(book: Book): Promise<boolean> {
  try {
    return book.blob instanceof Blob && book.blob.size === book.size &&
      await sha256(await book.blob.arrayBuffer()) === book.id;
  } catch { return false; }
}
// File blobs are shared locally; repairing them must preserve guest records too.
export async function cachePaper(paper: Paper, forceDownload = false): Promise<Book> {
  let book = (await listBooks()).find(b => b.id === paper.id);
  if (!book || forceDownload || !(await cachedPdfValid(book))) {
    const response = await fetch(`/api/papers/${paper.id}/pdf`, { cache: 'no-store' });
    if (!response.ok) throw new Error('PDF 加载失败，请重试');
    const fresh = await makeBook(await response.blob(), paper.fileName);
    if (fresh.id !== paper.id || fresh.pages !== paper.pages) throw new Error('PDF 校验失败，请联系上传者');
    if (book) {
      const files = { blob: fresh.blob, size: fresh.size, pages: fresh.pages, cover: fresh.cover, fileName: fresh.fileName };
      await patchBook(book.id, files);
      book = { ...book, ...files };
    } else {
      book = fresh;
      await putBook(book);
    }
  }
  const revision = await setting(`public-bundle:${paper.id}`);
  const metadata: Partial<Book> = { title: paper.title, author: paper.author, bilingual: paper.bilingual };
  if (paper.hasBundle && revision !== paper.updated) {
    const response = await fetch(`/api/papers/${paper.id}/bundle`);
    if (!response.ok) throw new Error('阅读包加载失败，请重试');
    const bundle = validateBundle(await response.json());
    if (bundle.pdfSha256 !== paper.id || bundle.pageCount !== paper.pages) throw new Error('阅读包与 PDF 不匹配');
    metadata.bundle = bundle;
  }
  await patchBook(book.id, metadata);
  if (metadata.bundle) await setting(`public-bundle:${paper.id}`, paper.updated);
  return { ...book, ...metadata };
}
