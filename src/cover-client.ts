import { api, ApiError } from './cloud-api';
import type { Paper } from './cloud-types';
import { loadPdfCover, renderPdfCover } from './pdf';
import { shelfHeaders } from './shelf-lock';
import { setting } from './storage';
import { jpegSize, COVER_MAX_BYTES } from './cover';

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
});
export async function jpegBlob(source: string): Promise<Blob> {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(source)) throw new Error('封面图片格式不正确');
  if (source.startsWith('data:image/jpeg;base64,')) {
    const bytes = Uint8Array.from(atob(source.slice('data:image/jpeg;base64,'.length)), c => c.charCodeAt(0));
    jpegSize(bytes);
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  const image = new Image(); image.src = source; await image.decode();
  const scale = Math.min(1, 480 / image.naturalWidth, 1000 / image.naturalHeight);
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d')!; context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  try { return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('封面生成失败')), 'image/jpeg', .82)); }
  finally { canvas.width = 0; canvas.height = 0; }
}
export async function uploadCover(paper: Paper, source: string, owner: string, signal?: AbortSignal): Promise<Paper> {
  const blob = await jpegBlob(source);
  const result = await api<{ paper: Paper }>(`/api/account/files/${paper.id}/cover`, {
    method: 'PUT', signal, headers: { 'Content-Type': 'image/jpeg', 'X-Margina-User': owner,
      'X-Cover-Pdf': paper.contentHash || paper.id, 'X-Cover-Crop': paper.bilingual ? 'zh' : 'full' }, body: blob,
  });
  return result.paper;
}
export async function storedCover(paper: Paper, owner: string | undefined, cachedCover: string | undefined, signal: AbortSignal): Promise<string> {
  const key = `cloud-cover-v1:${paper.privateOwner || 'public'}:${paper.id}:${paper.bilingual ? 'zh' : 'full'}:${paper.coverVersion || 'pending'}`;
  if (paper.coverVersion) {
    const saved = await setting(key).catch(() => undefined);
    if (typeof saved === 'string' && saved.startsWith('data:image/jpeg;base64,')) return saved;
  }
  if (signal.aborted) throw new Error('封面加载已取消');
  const route = paper.visibility === 'private' ? `/api/account/files/${paper.id}/cover` : `/api/papers/${paper.id}/cover`;
  const response = await fetch(`${route}${paper.coverVersion ? `?v=${encodeURIComponent(paper.coverVersion)}` : ''}`, { headers: shelfHeaders(), credentials: 'same-origin', redirect: 'error', signal });
  if (response.ok) {
    if (!response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('封面响应格式不正确');
    const blob = await response.blob();
    if (blob.size > COVER_MAX_BYTES) throw new Error('封面超过大小限制');
    const image = await dataUrl(blob);
    if (paper.coverVersion && !signal.aborted) await setting(key, image).catch(() => {});
    return image;
  }
  if (response.status !== 404) throw new ApiError('封面加载失败', response.status);
  // Readers never parse an entire PDF merely to display a missing cover.
  // An uploader/admin generates the legacy thumbnail once and saves it for all
  // authorized readers. A previously cached local cover can avoid that parse.
  if (!owner || !paper.canUpdateCover) return cachedCover || '';
  let image = cachedCover;
  if (!image) {
    const task = loadPdfCover(paper.visibility === 'private' ? `/api/account/files/${paper.id}/file` : `/api/papers/${paper.id}/file`, shelfHeaders());
    const cancel = () => { void task.destroy(); };
    signal.addEventListener('abort', cancel, { once: true });
    try { const pdf = await task.promise; image = await renderPdfCover(pdf, paper.bilingual); }
    finally { signal.removeEventListener('abort', cancel); await task.destroy(); }
  }
  if (signal.aborted) throw new Error('封面生成已取消');
  const updated = await uploadCover(paper, image, owner, signal);
  const jpeg = await dataUrl(await jpegBlob(image));
  if (!signal.aborted && updated.coverVersion) await setting(key.replace(/pending$/, updated.coverVersion), jpeg).catch(() => {});
  return jpeg;
}
