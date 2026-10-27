import { check, readBytes } from './validation.mjs';
import { jpegSize, COVER_MAX_BYTES } from '../src/cover.ts';
export const coverCrop = paper => paper.bilingual ? 'zh' : 'full';

export async function storeCover(env, paper, bytes, { reserve, discard }, onlyMissing = false) {
  try { jpegSize(bytes); } catch (error) { check(false, error.message); }
  const crop = coverCrop(paper);
  const old = await env.DB.prepare('SELECT * FROM paper_covers WHERE book_id = ? AND crop = ?').bind(paper.id, crop).first();
  if (onlyMissing && old) return;
  const version = crypto.randomUUID(), key = `covers/${paper.id}/${version}.jpg`;
  await reserve(env, key, bytes.byteLength);
  try {
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
    const result = await env.DB.prepare(`INSERT INTO paper_covers(book_id,crop,object_key,version)
      SELECT id,?,?,? FROM papers WHERE id = ? AND removed = 0 AND bilingual = ?
      AND (SELECT object_key FROM paper_covers WHERE book_id = ? AND crop = ?) IS ?
      ON CONFLICT(book_id,crop) DO UPDATE SET object_key=excluded.object_key, version=excluded.version`)
      .bind(crop, key, version, paper.id, paper.bilingual ? 1 : 0, paper.id, crop, old?.object_key ?? null).run();
    check(result.meta.changes === 1, '文献或封面已更新，请刷新后重试', 409);
  } catch (error) { await discard(env, key); throw error; }
  if (old) await discard(env, old.object_key);
}
export async function coverResponse(request, env, paper) {
  const record = await env.DB.prepare('SELECT * FROM paper_covers WHERE book_id = ? AND crop = ?').bind(paper.id, coverCrop(paper)).first();
  check(record, '封面尚未生成', 404);
  const headers = { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': paper.visibility === 'private' ? 'private, no-store' : 'private, no-cache', ETag: `"${record.version}"` };
  if (paper.visibility !== 'private' && request.headers.get('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers });
  const object = await env.FILES.get(record.object_key);
  check(object, '封面尚未生成', 404);
  return new Response(request.method === 'HEAD' ? null : object.body, { headers: { ...headers, 'Content-Length': String(object.size) } });
}
export async function coverUpload(request, env, paper, user, helpers) {
  check(paper && !paper.removed && !paper.pdf_key.endsWith('.txt'), '文献不存在或不可访问', 404);
  check(paper.owner === user.id || user.admin, '只有上传者或管理员可以生成封面', 403);
  check(request.headers.get('content-type') === 'image/jpeg', '请选择 JPEG 封面', 415);
  check(request.headers.get('x-cover-pdf') === (paper.content_hash || paper.id) && request.headers.get('x-cover-crop') === coverCrop(paper), '封面与 PDF 或裁切方式不匹配');
  const bytes = new Uint8Array(await readBytes(request, COVER_MAX_BYTES));
  await storeCover(env, paper, bytes, helpers, true);
}
