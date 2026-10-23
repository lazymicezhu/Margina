import { shelfHeaders } from './shelf-lock';
import type { Paper, Session } from './cloud-types';
import type { Book } from './types';
import { validateBundle } from './bundle';
import { getBook, putBook, patchBook, setting } from './storage';
import { makeBook } from './pdf';
import { makeTxtBook } from './txt-book';
import { sha256 } from './browser-compat';
import { readCachedPdf, type PdfSource } from './pdf-source';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const endpoint = path.startsWith('/api/private/') ? path.replace('/api/private/', '/api/account/') : path;
  const response = await fetch(endpoint, { ...options, headers: { ...shelfHeaders(), ...options.headers }, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError('服务连接失败，请刷新页面或重新登录。', response.status);
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error || '请求失败，请重试', response.status, body);
  return body;
}
export const session = () => api<Session>('/api/session');
export const catalog = (query = '', offset = 0) => api<{ papers: Paper[]; more: boolean }>(`/api/catalog?q=${encodeURIComponent(query)}&offset=${offset}`);
export async function getPaper(id: string): Promise<Paper> {
  try { return await api<Paper>(`/api/papers/${id}`); }
  catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; return api<Paper>(`/api/private/files/${id}`); }
}
const fileUrl = (paper: Paper, kind: 'file' | 'bundle') => paper.visibility === 'private' ? `/api/account/files/${paper.id}/${kind}` : `/api/papers/${paper.id}/${kind}`;
export const jsonOptions = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function uploadPdf(book: Book, user: string, visibility: 'public' | 'private' = 'public') {
  return api<{ paper: Paper; duplicate?: boolean }>(`/api/private/papers/${book.id}`, {
    method: 'PUT', headers: { 'Content-Type': book.format === 'txt' ? 'text/plain' : 'application/pdf', 'X-Paper-Visibility': visibility, 'X-Public-Upload': visibility === 'public' ? 'confirmed' : '', 'X-Margina-User': user,
      'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ title: book.title.slice(0, 500), author: book.author.slice(0, 300), fileName: book.fileName.slice(0, 255), pages: book.pages, bilingual: book.bilingual })) }, body: book.blob,
  });
}
export async function uploadBundle(file: File, user: string, visibility: 'public' | 'private' = 'public') {
  if (file.size > 20 * 1024 * 1024) throw new Error('阅读包不能超过 20 MB');
  const bundle = validateBundle(JSON.parse(await file.text()));
  const options = jsonOptions('PUT', bundle);
  return api<{ paper: Paper }>(`/api/private/papers/${bundle.pdfSha256}/bundle`, { ...options, headers: { ...options.headers, 'X-Margina-User': user, 'X-Paper-Visibility': visibility, 'X-Public-Upload': visibility === 'public' ? 'confirmed' : '' } });
}
// File blobs are shared locally; repairing them must preserve guest records too.
export async function cachePaper(paper: Paper, forceDownload = false): Promise<{ book: Book; source: PdfSource }> {
  let book = await getBook(paper.id);
  let bytes = book && !forceDownload ? await readCachedPdf(book) : null;
  if (!book || !bytes) {
    const response = await fetch(fileUrl(paper, 'file'), { headers: shelfHeaders(), cache: 'no-store', redirect: 'error', credentials: 'same-origin' });
    if (!response.ok) throw new Error('文件加载失败，请重试');
    bytes = await response.arrayBuffer();
    if (bytes.byteLength !== paper.size || await sha256(bytes) !== (paper.contentHash || paper.id)) throw new Error('文件校验失败，请联系上传者');
    const blob = new Blob([bytes], { type: paper.format === 'txt' ? 'text/plain' : 'application/pdf' });
    if (book) {
      const files = { blob, size: paper.size, pages: paper.pages, fileName: paper.fileName };
      await patchBook(book.id, files);
      book = { ...book, ...files };
    } else {
      // Only first import needs a thumbnail/metadata parse. Keep the verified
      // buffer for the reader; makeBook uses its own transferable buffer.
      book = await (paper.format === 'txt' ? makeTxtBook : makeBook)(blob, paper.fileName);
      book.id = paper.id; book.contentHash = paper.contentHash || paper.id;
      if (paper.visibility === 'private') book.privateOwner = paper.privateOwner;
      if (book.pages !== paper.pages) throw new Error('文件校验失败，请联系上传者');
      await putBook(book);
    }
  }
  const revision = await setting(`public-bundle:${paper.id}`);
  const metadata: Partial<Book> = {};
  if ((book.format || 'pdf') !== (paper.format || 'pdf')) metadata.format = paper.format;
  if (paper.contentHash && book.contentHash !== paper.contentHash) metadata.contentHash = paper.contentHash;
  if (paper.visibility === 'private' && book.privateOwner !== paper.privateOwner) metadata.privateOwner = paper.privateOwner;
  if (book.title !== paper.title) metadata.title = paper.title;
  if (book.author !== paper.author) metadata.author = paper.author;
  if (book.bilingual !== paper.bilingual) metadata.bilingual = paper.bilingual;
  if (paper.hasBundle && revision !== paper.updated) {
    const response = await fetch(fileUrl(paper, 'bundle'), { headers: shelfHeaders(), redirect: 'error', credentials: 'same-origin' });
    if (!response.ok) throw new Error('阅读包加载失败，请重试');
    const bundle = validateBundle(await response.json());
    if (bundle.pdfSha256 !== (paper.contentHash || paper.id) || bundle.pageCount !== paper.pages) throw new Error('阅读包与 PDF 不匹配');
    metadata.bundle = bundle;
  }
  if (Object.keys(metadata).length) await patchBook(book.id, metadata);
  if (metadata.bundle) await setting(`public-bundle:${paper.id}`, paper.updated);
  return { book: { ...book, ...metadata }, source: { bytes } };
}
