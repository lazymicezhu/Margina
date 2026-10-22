import { identity, localAuth, authConfigured, devCookie } from './auth.mjs';
import { check, readJson, readingData } from './validation.mjs';
import { validateBundle } from '../src/bundle.ts';
import { adminRequest, rememberUser } from './admin.mjs';

const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const publicPaper = p => ({ id: p.id, title: p.title, author: p.author, fileName: p.file_name, size: p.size, pages: p.pages,
  bilingual: !!p.bilingual, hasBundle: !!p.bundle_key, created: p.created, updated: p.updated, removed: !!p.removed });
const publicRecord = row => row ? { bookId: row.book_id, version: row.version, seq: row.seq, data: JSON.parse(row.data) } : null;
const getPaper = (env, id) => env.DB.prepare('SELECT * FROM papers WHERE id = ?').bind(id).first();
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
    const url = new URL(request.url); const path = url.pathname;
    try {
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      const mutating = !['GET', 'HEAD'].includes(request.method);
      if (mutating) {
        // Cookies never authorize cross-origin writes. No permissive CORS.
        check(request.headers.get('origin') === url.origin, '请从本站页面提交操作', 403);
      }
      if (path === '/api/session' && request.method === 'GET') {
        const user = await identity(request, env);
        await rememberUser(env, user);
        return json({ user, local: localAuth(request, env), loginAvailable: localAuth(request, env) || authConfigured(env) });
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
      if (path === '/api/catalog' && request.method === 'GET') {
        const query = (url.searchParams.get('q') || '').slice(0, 120);
        const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0));
        const { results } = await env.DB.prepare(`SELECT * FROM papers WHERE removed = 0 AND
          (instr(lower(title), lower(?)) > 0 OR instr(lower(author), lower(?)) > 0)
          ORDER BY created DESC, id LIMIT 41 OFFSET ?`).bind(query, query, offset).all();
        return json({ papers: results.slice(0, 40).map(publicPaper), more: results.length > 40 });
      }
      const publicMatch = path.match(/^\/api\/papers\/([a-f0-9]{64})(?:\/(pdf|bundle))?$/);
      if (publicMatch && ['GET', 'HEAD'].includes(request.method)) {
        const paper = await getPaper(env, publicMatch[1]);
        check(paper && !paper.removed, '文献不存在或已撤下', 404);
        const kind = publicMatch[2];
        if (!kind) return json(publicPaper(paper));
        const key = kind === 'pdf' ? paper.pdf_key : paper.bundle_key;
        check(key, '此文献尚无阅读包', 404);
        const object = await env.FILES.get(key);
        check(object, '文献文件暂时不可用', 404);
        return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
          'Content-Type': kind === 'pdf' ? 'application/pdf' : 'application/json; charset=utf-8',
          'Content-Length': String(object.size), 'Cache-Control': 'private, no-cache',
          'ETag': object.httpEtag, 'X-Content-Type-Options': 'nosniff',
          ...(kind === 'pdf' ? { 'Content-Disposition': 'inline; filename="paper.pdf"' } : {}),
        } });
      }
      if (!path.startsWith('/api/private/')) return json({ error: '接口不存在' }, 404);
      const user = await identity(request, env);
      check(user, '请先登录，再进行此操作', 401);
      if (request.headers.has('x-margina-user')) check(request.headers.get('x-margina-user') === user.id, '登录账号已变化，请刷新页面', 401);
      await rememberUser(env, user);
      if (path.startsWith('/api/private/admin/')) return await adminRequest(request, env, user, { json, publicPaper, publicRecord, discard });
      if (path === '/api/private/login' && request.method === 'GET') return Response.redirect(`${url.origin}${url.searchParams.get('next') === '/admin' ? '/admin' : '/'}`, 302);
      if (path === '/api/private/uploads' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM papers WHERE owner = ? ORDER BY created DESC LIMIT 200').bind(user.id).all();
        return json({ papers: results.map(publicPaper) });
      }
      if (path === '/api/private/records' && request.method === 'GET') {
        const cursor = Number(url.searchParams.get('after') || 0);
        check(Number.isSafeInteger(cursor) && cursor >= 0, '同步游标不正确');
        const { results } = await env.DB.prepare('SELECT * FROM reading WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 11').bind(user.id, cursor).all();
        const rows = results.slice(0, 10);
        return json({ records: rows.map(publicRecord), cursor: rows.at(-1)?.seq || cursor, more: results.length > 10 });
      }
      const recordMatch = path.match(/^\/api\/private\/records\/([a-f0-9]{64})$/);
      if (recordMatch && request.method === 'PUT') {
        const body = await readJson(request);
        check(Number.isSafeInteger(body.version) && body.version >= 0, '同步版本不正确');
        const paper = await getPaper(env, recordMatch[1]);
        check(paper, '请先将 PDF 上传到书库，再同步个人记录', 404);
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
        const id = uploadMatch[1]; const paper = await getPaper(env, id);
        if (request.method === 'DELETE' && !uploadMatch[2]) {
          check(paper && (paper.owner === user.id || user.admin), '只有上传者或管理员可以撤下文献', 403);
          const result = await env.DB.prepare('UPDATE papers SET removed = 1, updated = ? WHERE id = ? AND removed < 2').bind(Date.now(), id).run();
          check(result.meta.changes, '文献已删除或正在删除', 409);
          return json({ ok: true });
        }
        if (request.method === 'PUT' && uploadMatch[2]) {
          check(request.headers.get('x-public-upload') === 'confirmed', '请确认阅读包将公开分享');
          check(paper && !paper.removed, '请先上传与阅读包匹配的 PDF', 404);
          check(paper.owner === user.id || user.admin, '只有上传者或管理员可以更新阅读包', 403);
          const raw = await readJson(request, 20 * 1024 * 1024);
          let bundle;
          try { bundle = validateBundle(raw); } catch { check(false, '阅读包格式不正确'); }
          check(bundle.pdfSha256 === id && bundle.pageCount === paper.pages, '阅读包与 PDF 不匹配');
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
          check(request.headers.get('x-public-upload') === 'confirmed', '请确认文件将公开分享');
          if (paper) {
            check(!paper.removed, '该文献已撤下，请联系管理员', 409);
            return json({ paper: publicPaper(paper), duplicate: true });
          }
          const size = Number(request.headers.get('content-length'));
          check(size > 0 && size <= 100 * 1024 * 1024, 'PDF 须小于 100 MB，并提供文件长度', 413);
          check(request.headers.get('content-type') === 'application/pdf', '请选择 PDF 文件', 415);
          let meta;
          try { meta = JSON.parse(decodeURIComponent(request.headers.get('x-paper-metadata') || '')); } catch { check(false, '文献信息不正确'); }
          check(meta && typeof meta.title === 'string' && meta.title.trim() && meta.title.length <= 500 && typeof meta.author === 'string' && meta.author.length <= 300 && typeof meta.fileName === 'string' && meta.fileName.length <= 255 && Number.isInteger(meta.pages) && meta.pages > 0 && meta.pages <= 20000, '文献信息不正确');
          const key = `papers/${id}/${crypto.randomUUID()}.pdf`;
          await reserve(env, key, size);
          try {
            // R2 verifies the browser-computed SHA-256 while streaming. Do not
            // load a 100 MB PDF into the Worker's 128 MB heap.
            await env.FILES.put(key, request.body, { sha256: id, httpMetadata: { contentType: 'application/pdf' } });
            const head = await env.FILES.get(key, { range: { offset: 0, length: 1024 } });
            check(head && (await head.text()).includes('%PDF-'), '不是有效的 PDF 文件');
            const now = Date.now();
            const result = await env.DB.prepare(`INSERT OR IGNORE INTO papers
              (id, title, author, file_name, size, pages, bilingual, pdf_key, owner, created, updated)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, meta.title.trim(), meta.author, meta.fileName, size, meta.pages, meta.bilingual ? 1 : 0, key, user.id, now, now).run();
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
