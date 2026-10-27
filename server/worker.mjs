import { passwordRequest, passwordStatus, passwordAuthEnabled } from './password-auth.mjs';
import { shelfAccess, shelfRequest } from './shelf.mjs';
import { catalogFolders, catalogFolderRequest, requireCatalogFolder, paperWithFolder } from './catalog-folders.mjs';
import { parseTxt, TXT_MAX_BYTES } from '../src/txt.ts';
import { identity, localAuth, authConfigured, devCookie, accessIdentity } from './auth.mjs';
import { check, readJson, readBytes, readingData } from './validation.mjs';
import { validateBundle } from '../src/bundle.ts';
import { adminRequest, rememberUser } from './admin.mjs';

const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const publicPaper = (p, user) => ({ id: p.id, catalogFolderId: p.catalog_folder_id || null, catalogFolderName: p.catalog_folder_name || null,
  canOrganize: !!user && p.visibility === 'public' && (p.removed === 0 || (user.admin && p.removed === 1)) && (p.owner === user.id || user.admin), title: p.title, author: p.author, fileName: p.file_name, size: p.size, pages: p.pages,
  format: p.pdf_key.endsWith('.txt') ? 'txt' : 'pdf', contentHash: p.content_hash || p.id, visibility: p.visibility, ...(p.visibility === 'private' ? { privateOwner: p.owner } : {}), bilingual: !!p.bilingual, hasBundle: !!p.bundle_key, created: p.created, updated: p.updated, removed: !!p.removed });
const publicRecord = row => row ? { bookId: row.book_id, version: row.version, seq: row.seq, data: JSON.parse(row.data) } : null;
const getPaper = (env, id) => env.DB.prepare(`${paperWithFolder} WHERE p.id = ?`).bind(id).first();
async function privateId(user, hash) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`private:${user}:${hash}`));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
const canRead = (paper, user) => paper && (paper.visibility !== 'private' || paper.owner === user.id || user.admin);
async function fileResponse(request, env, paper, kind) {
  const txt = paper.pdf_key.endsWith('.txt');
  check(kind !== 'pdf' || !txt, '不是 PDF 文件', 404);
  const key = kind === 'bundle' ? paper.bundle_key : paper.pdf_key;
  check(key, '此文献尚无阅读包', 404);
  // PDF.js requests only the chunks needed for visible first-page thumbnails.
  const rangeHeader = request.method === 'GET' && kind !== 'bundle' && !txt ? request.headers.get('range') : null;
  let range;
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const offset = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), paper.size - 1) : paper.size - 1;
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset > end || offset >= paper.size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${paper.size}`, 'Cache-Control': 'private, no-store' } });
      }
      range = { offset, length: end - offset + 1 };
    }
  }
  const object = await env.FILES.get(key, range ? { range } : undefined);
  check(object, '文献文件暂时不可用', 404);
  return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers: {
    ...(kind !== 'bundle' && !txt ? { 'Accept-Ranges': 'bytes' } : {}),
    ...(range ? { 'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}` } : {}),
    'Content-Type': kind === 'bundle' ? 'application/json; charset=utf-8' : txt ? 'text/plain' : 'application/pdf',
    'Content-Length': String(range?.length ?? object.size), 'Cache-Control': 'private, no-store', 'ETag': object.httpEtag,
    'X-Content-Type-Options': 'nosniff',
    ...(kind !== 'bundle' ? { 'Content-Disposition': txt ? 'attachment; filename="book.txt"' : 'inline; filename="paper.pdf"' } : {}),
  } });
}

async function reserve(env, key, bytes) {
  const configured = Number(env.MAX_STORAGE_BYTES || 8000000000);
  const maximum = Number.isSafeInteger(configured) && configured > 0 ? configured : 8000000000;
  const row = await env.DB.prepare(`INSERT INTO storage_allocations(object_key, bytes)
    SELECT ?, ? WHERE COALESCE((SELECT SUM(bytes) FROM storage_allocations), 0) + ? <= ? RETURNING object_key`)
    .bind(key, bytes, bytes, maximum).first();
  check(row, '书库已达到存储上限，暂时无法上传新文件。', 413);
}
async function discard(env, key) {
  await env.FILES.delete(key);
  await env.DB.prepare('DELETE FROM storage_allocations WHERE object_key = ?').bind(key).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Account routes use the same owner/admin guards; Access remains for email verification.
    if (url.pathname.startsWith('/api/account/')) { url.pathname = url.pathname.replace('/api/account/', '/api/private/'); request = new Request(url, request); }
    const path = url.pathname;
    try {
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      const mutating = !['GET', 'HEAD'].includes(request.method);
      if (mutating) {
        // Cookies never authorize cross-origin writes. No permissive CORS.
        check(request.headers.get('origin') === url.origin, '请从本站页面提交操作', 403);
      }
      if (path.startsWith('/api/auth/') || path === '/api/private/auth/verify') return await passwordRequest(request, env, accessIdentity);
      if (path === '/api/session' && request.method === 'GET') {
        const user = await identity(request, env);
        await rememberUser(env, user);
        return json({ user, local: localAuth(request, env), loginAvailable: localAuth(request, env) || passwordAuthEnabled(env) || authConfigured(env), ...await passwordStatus(request, env) });
      }
      if (path === '/api/dev/login' && request.method === 'POST') {
        check(localAuth(request, env), '本地测试登录未启用', 404);
        const { name } = await readJson(request, 200);
        return json({ ok: true }, 200, { 'Set-Cookie': await devCookie(name) });
      }
      if (path === '/api/dev/logout' && request.method === 'POST') {
        check(localAuth(request, env), '本地测试登录未启用', 404);
        return json({ ok: true }, 200, { 'Set-Cookie': 'margina_dev=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (path === '/api/catalog/folders' && request.method === 'GET') {
        return json({ folders: await catalogFolders(env, await identity(request, env)) });
      }
      if (path === '/api/catalog' && request.method === 'GET') {
        const user = await identity(request, env);
        const query = (url.searchParams.get('q') || '').slice(0, 120);
        const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0));
        const folderId = url.searchParams.get('folder');
        if (folderId) await requireCatalogFolder(env, folderId);
        const { results } = await env.DB.prepare(`${paperWithFolder} WHERE p.removed = 0 AND p.visibility = 'public' AND
          (? = 0 OR i.folder_id IS ?) AND (instr(lower(p.title), lower(?)) > 0 OR instr(lower(p.author), lower(?)) > 0)
          ORDER BY p.created DESC, p.id LIMIT 41 OFFSET ?`).bind(folderId === null ? 0 : 1, folderId || null, query, query, offset).all();
        return json({ papers: results.slice(0, 40).map(p => publicPaper(p, user)), more: results.length > 40 });
      }
      const publicMatch = path.match(/^\/api\/papers\/([a-f0-9]{64})(?:\/(pdf|file|bundle))?$/);
      if (publicMatch && ['GET', 'HEAD'].includes(request.method)) {
        const paper = await getPaper(env, publicMatch[1]);
        check(paper && !paper.removed && paper.visibility === 'public', '文献不存在或已撤下', 404);
        const kind = publicMatch[2];
        if (!kind) return json(publicPaper(paper));
        return fileResponse(request, env, paper, kind);
      }
      if (!path.startsWith('/api/private/')) return json({ error: '接口不存在' }, 404);
      const user = await identity(request, env);
      check(user, '请先登录，再进行此操作', 401);
      if (request.headers.has('x-margina-user')) check(request.headers.get('x-margina-user') === user.id, '登录账号已变化，请刷新页面', 401);
      await rememberUser(env, user);
      if (path.startsWith('/api/private/admin/')) return await adminRequest(request, env, user, { json, publicPaper, publicRecord, discard });
      const shelf = await shelfAccess(request, env, user);
      if (path === '/api/private/metadata' && request.method === 'GET') {
        const ids = [...new Set((url.searchParams.get('ids') || '').split(','))];
        check(ids.length <= 40 && ids.every(id => /^[a-f0-9]{64}$/.test(id)), '文献列表不正确');
        const { results } = await env.DB.prepare(`${paperWithFolder} WHERE p.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
        const papers = [], unavailable = [], locked = [];
        for (const id of ids) {
          if (shelf.blockedBooks.has(id)) { locked.push(id); continue; }
          const paper = results.find(p => p.id === id);
          if (!canRead(paper, user) || paper.removed) unavailable.push(id);
          else papers.push(publicPaper(paper, user));
        }
        return json({ papers, unavailable, locked });
      }
      if (path.startsWith('/api/private/shelf')) return await shelfRequest(request, env, user, shelf, json);
      if (path.startsWith('/api/private/catalog/')) return await catalogFolderRequest(request, env, user, shelf, json);
      const privateFile = path.match(/^\/api\/private\/files\/([a-f0-9]{64})(?:\/(file|bundle))?$/);
      if (privateFile && ['GET', 'HEAD'].includes(request.method)) {
        shelf.requireBook(privateFile[1]);
        const paper = await getPaper(env, privateFile[1]);
        check(canRead(paper, user) && !paper.removed, '文献不存在或不可访问', 404);
        return privateFile[2] ? fileResponse(request, env, paper, privateFile[2]) : json(publicPaper(paper));
      }

      if (path === '/api/private/login' && request.method === 'GET') return Response.redirect(`${url.origin}${url.searchParams.get('next') === '/admin' ? '/admin' : '/'}`, 302);
      if (path === '/api/private/uploads' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`${paperWithFolder} WHERE p.owner = ? AND p.removed <> 2 ORDER BY p.created DESC LIMIT 200`).bind(user.id).all();
        return json({ papers: results.filter(p => !shelf.blockedBooks.has(p.id)).map(p => publicPaper(p, user)) });
      }
      if (path === '/api/private/records' && request.method === 'GET') {
        const cursor = Number(url.searchParams.get('after') || 0);
        check(Number.isSafeInteger(cursor) && cursor >= 0, '同步游标不正确');
        const { results } = await env.DB.prepare('SELECT * FROM reading WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 11').bind(user.id, cursor).all();
        const rows = results.slice(0, 10);
        return json({ records: rows.filter(r => !shelf.blockedBooks.has(r.book_id)).map(publicRecord), cursor: rows.at(-1)?.seq || cursor, more: results.length > 10 });
      }
      const recordMatch = path.match(/^\/api\/private\/records\/([a-f0-9]{64})$/);
      if (recordMatch && request.method === 'PUT') {
        shelf.requireBook(recordMatch[1]);
        const body = await readJson(request);
        check(Number.isSafeInteger(body.version) && body.version >= 0, '同步版本不正确');
        const paper = await getPaper(env, recordMatch[1]);
        check(canRead(paper, user), '文献不存在或不可访问', 404);
        const data = readingData(body.data, paper.pages);
        const row = await env.DB.prepare(`INSERT OR REPLACE INTO reading (user_id, book_id, version, data)
          SELECT ?, ?, ?, ? WHERE COALESCE((SELECT version FROM reading WHERE user_id = ? AND book_id = ?), 0) = ?
          RETURNING *`).bind(user.id, paper.id, body.version + 1, JSON.stringify(data), user.id, paper.id, body.version).first();
        if (row) return json({ record: publicRecord(row) });
        const current = await env.DB.prepare('SELECT * FROM reading WHERE user_id = ? AND book_id = ?').bind(user.id, paper.id).first();
        return json({ error: '其他设备已有修改，正在合并', record: publicRecord(current) }, 409);
      }
      const uploadMatch = path.match(/^\/api\/private\/papers\/([a-f0-9]{64})(?:\/(bundle))?$/);
      if (uploadMatch) {
        const hash = uploadMatch[1];
        const visibility = request.headers.get('x-paper-visibility') || 'public';
        check(['public', 'private'].includes(visibility), '可见范围不正确');
        const id = request.method === 'PUT' && visibility === 'private' ? await privateId(user.id, hash) : hash;
        shelf.requireBook(id);
        const paper = await getPaper(env, id);
        if (request.method === 'DELETE' && !uploadMatch[2]) {
          check(paper && (paper.owner === user.id || user.admin), '只有上传者或管理员可以撤下文献', 403);
          const result = await env.DB.prepare('UPDATE papers SET removed = 1, updated = ? WHERE id = ? AND removed < 2').bind(Date.now(), id).run();
          check(result.meta.changes, '文献已删除或正在删除', 409);
          return json({ ok: true });
        }
        if (request.method === 'PUT' && uploadMatch[2]) {
          check(visibility === 'private' || request.headers.get('x-public-upload') === 'confirmed', '请确认阅读包将公开分享');
          check(canRead(paper, user) && !paper.removed && !paper.pdf_key.endsWith('.txt'), '请先上传与阅读包匹配的 PDF', 404);
          check(paper.owner === user.id || user.admin, '只有上传者或管理员可以更新阅读包', 403);
          const raw = await readJson(request, 20 * 1024 * 1024);
          let bundle;
          try { bundle = validateBundle(raw); } catch { check(false, '阅读包格式不正确'); }
          check(bundle.pdfSha256 === (paper.content_hash || paper.id) && bundle.pageCount === paper.pages, '阅读包与 PDF 不匹配');
          const key = `bundles/${id}/${crypto.randomUUID()}.json`;
          const encoded = JSON.stringify(bundle);
          await reserve(env, key, new TextEncoder().encode(encoded).byteLength);
          try {
            await env.FILES.put(key, encoded, { httpMetadata: { contentType: 'application/json' } });
            const result = await env.DB.prepare('UPDATE papers SET bundle_key = ?, bilingual = 1, title = ?, author = ?, updated = ? WHERE id = ? AND removed = 0 AND bundle_key IS ?')
              .bind(key, bundle.title.slice(0, 500), bundle.author.slice(0, 300), Date.now(), id, paper.bundle_key).run();
            check(result.meta.changes === 1, '文献刚被修改，请刷新后重试', 409);
          } catch (error) { await discard(env, key); throw error; }
          if (paper.bundle_key) await discard(env, paper.bundle_key);
          return json({ paper: publicPaper(await getPaper(env, id)) });
        }
        if (request.method === 'PUT' && !uploadMatch[2]) {
          check(visibility === 'private' || request.headers.get('x-public-upload') === 'confirmed', '请确认文件将公开分享');
          const catalogFolderId = request.headers.get('x-catalog-folder') || null;
          check(!catalogFolderId || visibility === 'public', '私密文献不能放入公开书库文件夹');
          if (catalogFolderId) await requireCatalogFolder(env, catalogFolderId);
          if (paper) {
            check(canRead(paper, user) && !paper.removed, '该文献不可用，请联系管理员', 409);
            return json({ paper: publicPaper(paper), duplicate: true });
          }
          const size = Number(request.headers.get('content-length'));
          const mime = request.headers.get('content-type')?.split(';')[0];
          const txt = mime === 'text/plain';
          check(txt || mime === 'application/pdf', '请选择 PDF 或 TXT 文件', 415);
          check(size > 0 && size <= (txt ? TXT_MAX_BYTES : 100 * 1024 * 1024), txt ? 'TXT 须小于 10 MB' : 'PDF 须小于 100 MB，并提供文件长度', 413);
          let meta;
          try { meta = JSON.parse(decodeURIComponent(request.headers.get('x-paper-metadata') || '')); } catch { check(false, '文献信息不正确'); }
          check(meta && typeof meta.title === 'string' && meta.title.trim() && meta.title.length <= 500 && typeof meta.author === 'string' && meta.author.length <= 300 && typeof meta.fileName === 'string' && meta.fileName.length <= 255 && Number.isInteger(meta.pages) && meta.pages > 0 && meta.pages <= 20000, '文献信息不正确');
          let uploadBody = request.body;
          if (txt) {
            const bytes = await readBytes(request, TXT_MAX_BYTES);
            check(bytes.byteLength === size && bytes.byteLength <= TXT_MAX_BYTES, 'TXT 大小不正确', 413);
            try { meta.pages = parseTxt(bytes).length; } catch (error) { check(false, error.message); }
            meta.bilingual = false; uploadBody = bytes;
          }
          const key = `papers/${id}/${crypto.randomUUID()}.${txt ? 'txt' : 'pdf'}`;
          await reserve(env, key, size);
          try {
            // R2 verifies the browser-computed SHA-256 while streaming. Do not
            // load a 100 MB PDF into the Worker's 128 MB heap.
            await env.FILES.put(key, uploadBody, { sha256: hash, httpMetadata: { contentType: mime } });
            if (!txt) {
              const head = await env.FILES.get(key, { range: { offset: 0, length: 1024 } });
              check(head && (await head.text()).includes('%PDF-'), '不是有效的 PDF 文件');
            }
            const now = Date.now();
            const insert = env.DB.prepare(`INSERT OR IGNORE INTO papers
              (id, title, author, file_name, size, pages, bilingual, pdf_key, owner, created, updated, content_hash, visibility)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, meta.title.trim(), meta.author, meta.fileName, size, meta.pages, meta.bilingual ? 1 : 0, key, user.id, now, now, hash, visibility);
            // Publish metadata and classification together. Concurrent duplicate
            // uploads keep the winning document's location and ownership.
            const [result] = await env.DB.batch([insert, ...(catalogFolderId ? [env.DB.prepare(`INSERT INTO catalog_items(book_id, folder_id)
              SELECT id, ? FROM papers WHERE id = ? AND pdf_key = ?`).bind(catalogFolderId, id, key)] : [])]);
            if (!result.meta.changes) await discard(env, key);
          } catch (error) { await discard(env, key); throw error; }
          return json({ paper: publicPaper(await getPaper(env, id)) }, 201);
        }
      }
      return json({ error: '接口不存在' }, 404);
    } catch (error) {
      return json({ error: error.status ? error.message : '服务暂时不可用，请稍后重试；本地记录仍保留。' }, error.status || 503);
    }
  },
};
