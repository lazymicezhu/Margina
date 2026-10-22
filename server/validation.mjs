export const HASH = /^[a-f0-9]{64}$/;
export function check(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
export async function readJson(request, limit = 1024 * 1024) {
  check(request.headers.get('content-type')?.includes('application/json'), '请求必须为 JSON', 415);
  check(Number(request.headers.get('content-length') || 0) <= limit, '数据超过大小限制', 413);
  const reader = request.body?.getReader();
  check(reader, '缺少数据');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); check(false, '数据超过大小限制', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const value of chunks) { bytes.set(value, offset); offset += value.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { check(false, 'JSON 格式不正确'); }
}
export function readingData(data, pages) {
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  check(data && typeof data.shelf === 'boolean' && typeof data.starred === 'boolean', '书架数据不正确');
  check(integer(data.page, 1, pages) && integer(data.opened, 0, Number.MAX_SAFE_INTEGER), '阅读页码不正确');
  check(Array.isArray(data.bookmarks) && data.bookmarks.length <= pages && data.bookmarks.every(p => integer(p, 1, pages)), '书签数据不正确');
  check(Array.isArray(data.annotations) && data.annotations.length <= 2000, '笔记数量超过限制');
  const ids = new Set();
  for (const n of data.annotations) {
    check(n && typeof n.id === 'string' && n.id.length > 0 && n.id.length <= 200 && !ids.has(n.id), '笔记标识不正确'); ids.add(n.id);
    check(integer(n.page, 1, pages) && ['zh', 'en', 'both'].includes(n.language) && ['yellow', 'green', 'pink'].includes(n.color), '笔记位置或颜色不正确');
    check(typeof n.text === 'string' && n.text.length <= 50000 && typeof n.quote === 'string' && n.quote.length <= 50000, '笔记文字超过限制');
    check(integer(n.created, 0, Number.MAX_SAFE_INTEGER) && integer(n.updated, 0, Number.MAX_SAFE_INTEGER), '笔记时间不正确');
    check(n.segmentId === undefined || (typeof n.segmentId === 'string' && n.segmentId.length <= 500), '段落标识不正确');
    check(Array.isArray(n.rects) && n.rects.length <= 1000 && n.rects.every(r => ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]) && r[k] >= 0 && r[k] <= 1)), '高亮坐标不正确');
  }
  // Never persist arbitrary properties such as files, identities or secrets.
  return { shelf: data.shelf, starred: data.starred, page: data.page, opened: data.opened,
    bookmarks: [...new Set(data.bookmarks)], annotations: data.annotations.map(n => ({
      id: n.id, page: n.page, quote: n.quote, text: n.text, rects: n.rects.map(({ x, y, width, height }) => ({ x, y, width, height })),
      color: n.color, created: n.created, updated: n.updated, language: n.language, ...(n.segmentId ? { segmentId: n.segmentId } : {}),
    })) };
}
