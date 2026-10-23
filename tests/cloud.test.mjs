import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHash } from 'node:crypto';

let mf, directory, alice, bob;
const bytes = Buffer.from('%PDF-1.4\n% Synthetic test fixture; no real paper\n%%EOF\n');
const id = createHash('sha256').update(bytes).digest('hex');
const empty = () => ({ shelf: false, starred: false, page: 1, opened: 0, bookmarks: [], annotations: [] });
async function request(path, method = 'GET', body, cookie, headers = {}) {
  const init = { method, headers: { ...(method !== 'GET' ? { Origin: 'http://localhost' } : {}), ...(path.endsWith('/bundle') && method === 'PUT' ? { 'X-Public-Upload': 'confirmed' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  return mf.dispatchFetch(`http://localhost${path}`, init);
}
async function upload(cookie, override = {}) {
  return mf.dispatchFetch(`http://localhost/api/private/papers/${id}`, {
    method: 'PUT', headers: { Origin: 'http://localhost', Cookie: cookie, 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length),
      'X-Public-Upload': 'confirmed', 'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ title: 'Synthetic paper', author: 'Margina tests', pages: 2, bilingual: false, fileName: 'test.pdf' })), ...override }, body: bytes,
  });
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'margina-worker-test-'));
  const outfile = join(directory, 'worker.mjs');
  await build({ entryPoints: ['server/worker.mjs'], bundle: true, format: 'esm', platform: 'browser', outfile, logLevel: 'silent' });
  mf = new Miniflare(convertV4MiniflareOptions({ name: 'margina-tests', modules: true, script: await readFile(outfile, 'utf8'), compatibilityDate: '2026-10-22', d1Databases: ['DB'], r2Buckets: ['FILES'], bindings: { ENVIRONMENT: 'local', LOCAL_DEV_AUTH: 'true' } }));
  const db = await mf.getD1Database('DB');
  const schema = await readFile('server/schema.sql', 'utf8');
  for (const sql of schema.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) await db.prepare(sql).run();
  alice = (await request('/api/dev/login', 'POST', { name: 'alice' })).headers.get('set-cookie').split(';')[0];
  bob = (await request('/api/dev/login', 'POST', { name: 'bob' })).headers.get('set-cookie').split(';')[0];
});
after(async () => { await mf?.dispose(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('guests can browse, but cannot upload, sync, or forge identity', async () => {
  assert.equal((await request('/api/catalog')).status, 200);
  assert.equal((await request('/api/private/records')).status, 401);
  assert.equal((await request('/api/private/records', 'GET', undefined, undefined, { 'Cf-Access-Authenticated-User-Email': 'alice@local.test' })).status, 401);
  assert.equal((await upload('')).status, 401);
  assert.equal((await request('/api/session')).status, 200);
});
test('upload requires same origin and explicit public consent', async () => {
  assert.equal((await upload(alice, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await upload(alice, { 'X-Public-Upload': '' })).status, 400);
});
test('PDF uploaded once, public catalogue never includes account identities', async () => {
  const result = await upload(alice);
  assert.equal(result.status, 201, await result.clone().text());
  const paper = (await result.json()).paper;
  assert.equal(paper.id, id); assert.equal(paper.owner, undefined);
  assert.equal((await upload(bob)).status, 200);
  const papers = (await (await request('/api/catalog')).json()).papers;
  assert.equal(papers.length, 1);
  assert.equal(JSON.stringify(papers).includes('local-alice'), false);
  const response = await request(`/api/papers/${id}/pdf`);
  assert.equal(response.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), bytes), 0);
});
test('wrong PDF hash cannot publish a document', async () => {
  const badId = 'a'.repeat(64);
  const response = await mf.dispatchFetch(`http://localhost/api/private/papers/${badId}`, { method: 'PUT', body: bytes, headers: {
    Origin: 'http://localhost', Cookie: alice, 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length), 'X-Public-Upload': 'confirmed',
    'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ title: 'bad', author: '', pages: 1, fileName: 'bad.pdf' })),
  } });
  assert.notEqual(response.status, 201);
  assert.equal((await request(`/api/papers/${badId}`)).status, 404);
});
test('reading records are isolated and concurrent writes use compare-and-swap', async () => {
  const data = { ...empty(), shelf: true, page: 2, annotations: [{ id: 'note', page: 2, quote: 'Quote', text: 'Private note', rects: [], color: 'yellow', language: 'en', created: 1, updated: 1 }] };
  const put = await request(`/api/private/records/${id}`, 'PUT', { version: 0, data }, alice);
  assert.equal(put.status, 200, await put.clone().text());
  assert.equal((await put.json()).record.version, 1);
  const conflict = await request(`/api/private/records/${id}`, 'PUT', { version: 0, data: empty() }, alice);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).record.data.annotations[0].text, 'Private note');
  const b = await (await request('/api/private/records', 'GET', undefined, bob)).json();
  assert.equal(b.records.length, 0);
  assert.equal((await request(`/api/private/records/${id}`, 'PUT', { version: 0, data }, bob, { 'X-Margina-User': 'local-alice' })).status, 401);
  const a = await (await request('/api/private/records', 'GET', undefined, alice)).json();
  const removal = await request(`/api/private/records/${id}`, 'PUT', { version: 1, data: { ...data, shelf: false } }, alice);
  assert.equal(removal.status, 200);
  const changes = await (await request(`/api/private/records?after=${a.cursor}`, 'GET', undefined, alice)).json();
  assert.equal(changes.records.length, 1); assert.equal(changes.records[0].data.shelf, false);
  assert.equal(changes.records[0].data.annotations.length, 1);
});
test('invalid reading data and bad cursor are rejected', async () => {
  assert.equal((await request(`/api/private/records/${id}`, 'PUT', { version: 2, data: { ...empty(), page: 100 } }, alice)).status, 400);
  assert.equal((await request('/api/private/records?after=NaN', 'GET', undefined, alice)).status, 400);
});
test('two simultaneous writes to the same version cannot both succeed', async () => {
  const responses = await Promise.all([
    request(`/api/private/records/${id}`, 'PUT', { version: 0, data: { ...empty(), shelf: true } }, bob),
    request(`/api/private/records/${id}`, 'PUT', { version: 0, data: { ...empty(), page: 2 } }, bob),
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
});
test('only owner/admin can attach a matching reading bundle', async () => {
  const bundle = { format: 'yuejian-babeldoc-v1', pdfSha256: id, title: '双语测试', author: 'Test', pageCount: 2, segments: [{ id: 'one', page: 1, source: 'Hello', zh: '你好', keep: true }], glossary: { Hello: '你好' } };
  assert.equal((await request(`/api/private/papers/${id}/bundle`, 'PUT', bundle, bob)).status, 403);
  assert.equal((await request(`/api/private/papers/${id}/bundle`, 'PUT', { ...bundle, pageCount: 3 }, alice)).status, 400);
  assert.equal((await request(`/api/private/papers/${id}/bundle`, 'PUT', { ...bundle, pdfSha256: 'b'.repeat(64) }, alice)).status, 400);
  const result = await request(`/api/private/papers/${id}/bundle`, 'PUT', bundle, alice);
  assert.equal(result.status, 200, await result.clone().text());
  assert.equal((await (await request(`/api/papers/${id}/bundle`)).json()).title, '双语测试');
});
test('uncollect preserves public paper; withdrawal blocks public files but keeps private notes', async () => {
  assert.equal((await request(`/api/papers/${id}/pdf`)).status, 200);
  assert.equal((await request(`/api/private/papers/${id}`, 'DELETE', undefined, bob)).status, 403);
  assert.equal((await request(`/api/private/papers/${id}`, 'DELETE', undefined, alice)).status, 200);
  assert.equal((await request(`/api/papers/${id}/pdf`)).status, 404);
  assert.equal((await request(`/api/papers/${id}/bundle`)).status, 404);
  assert.equal((await (await request('/api/catalog')).json()).papers.length, 0);
  const personal = await (await request('/api/private/records', 'GET', undefined, alice)).json();
  assert.equal(personal.records[0].data.annotations[0].text, 'Private note');
});
test('local test identity is unavailable on public hostnames', async () => {
  const response = await mf.dispatchFetch('https://public.example/api/dev/login', { method: 'POST', headers: { Origin: 'https://public.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'alice' }) });
  assert.equal(response.status, 404);
  const session = await mf.dispatchFetch('https://public.example/api/session', { headers: { Cookie: alice } });
  assert.equal((await session.json()).user, null);
});
test('storage reservations reject uploads beyond the library budget', async () => {
  const db = await mf.getD1Database('DB');
  await db.prepare("INSERT INTO storage_allocations VALUES ('budget-test', 8000000000)").run();
  const blocked = await mf.dispatchFetch(`http://localhost/api/private/papers/${'c'.repeat(64)}`, { method: 'PUT', body: bytes, headers: {
    Origin: 'http://localhost', Cookie: alice, 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length), 'X-Public-Upload': 'confirmed',
    'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ title: 'budget test', author: '', pages: 1, fileName: 'budget.pdf' })),
  } });
  assert.equal(blocked.status, 413);
  assert.match((await blocked.json()).error, /存储上限/);
});

test('private TXT is isolated by account and is never exposed through public metadata/files/search', async () => {
  await (await mf.getD1Database('DB')).prepare("DELETE FROM storage_allocations WHERE object_key = 'budget-test'").run();
  const content = Buffer.from('第一章\n\n私密文本用于验证权限。\n'.repeat(100));
  const hash = createHash('sha256').update(content).digest('hex');
  const send = (cookie, visibility) => mf.dispatchFetch(`http://localhost/api/private/papers/${hash}`, {
    method: 'PUT', body: content, headers: { Origin: 'http://localhost', Cookie: cookie, 'Content-Type': 'text/plain', 'Content-Length': String(content.length), 'X-Paper-Visibility': visibility,
      ...(visibility === 'public' ? { 'X-Public-Upload': 'confirmed' } : {}),
      'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ title: 'Private TXT', author: '', pages: 1, fileName: 'private.txt' })),
    },
  });
  const uploaded = await send(alice, 'private');
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const paper = (await uploaded.json()).paper;
  assert.equal(paper.format, 'txt'); assert.equal(paper.visibility, 'private');
  assert.equal(paper.contentHash, hash); assert.notEqual(paper.id, hash); assert.ok(paper.pages > 1);
  for (const suffix of ['', '/pdf', '/file', '/bundle']) {
    assert.equal((await request(`/api/papers/${paper.id}${suffix}`)).status, 404);
    assert.equal((await request(`/api/papers/${paper.id}${suffix}`, 'HEAD')).status, 404);
  }
  assert.equal((await request(`/api/private/files/${paper.id}/file`)).status, 401);
  assert.equal((await request(`/api/private/files/${paper.id}/file`, 'GET', undefined, bob)).status, 404);
  assert.equal((await request(`/api/private/files/${paper.id}`, 'GET', undefined, bob)).status, 404);
  assert.equal((await request(`/api/private/records/${paper.id}`, 'PUT', { version: 0, data: empty() }, bob)).status, 404);
  assert.equal((await request(`/api/private/papers/${paper.id}`, 'DELETE', undefined, bob)).status, 403);
  const file = await request(`/api/private/files/${paper.id}/file`, 'GET', undefined, alice);
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'text/plain');
  assert.equal(await file.text(), content.toString());
  const noteData = { ...empty(), shelf: true, page: 2, annotations: [{ id: 'txt-note', page: 2, quote: '私密文本', text: '笔记', rects: [], color: 'yellow', language: 'zh', segmentId: 'txt-2-0', created: 1, updated: 1 }] };
  assert.equal((await request(`/api/private/records/${paper.id}`, 'PUT', { version: 0, data: noteData }, alice)).status, 200);
  assert.equal((await (await request('/api/catalog?q=Private')).json()).papers.length, 0);
  const other = (await (await send(bob, 'private')).json()).paper;
  assert.notEqual(other.id, paper.id);
  const published = (await (await send(bob, 'public')).json()).paper;
  assert.equal(published.id, hash); assert.equal(published.visibility, 'public');
  assert.equal((await request(`/api/papers/${published.id}/file`)).status, 200);
  assert.equal((await request(`/api/papers/${paper.id}/file`)).status, 404);
  const uploads = (await (await request('/api/private/uploads', 'GET', undefined, alice)).json()).papers;
  assert.ok(uploads.some(p => p.id === paper.id)); assert.ok(!uploads.some(p => p.id === other.id));
});

test('private PDF bundles stay private and validate against file hash, not document id', async () => {
  const result = await upload(alice, { 'X-Paper-Visibility': 'private', 'X-Public-Upload': '' });
  assert.equal(result.status, 201, await result.clone().text());
  const paper = (await result.json()).paper;
  const bundle = { format: 'yuejian-babeldoc-v1', pdfSha256: id, title: 'Private bilingual', author: 'Test', pageCount: 2, segments: [], glossary: {} };
  const response = await request(`/api/private/papers/${id}/bundle`, 'PUT', bundle, alice, { 'X-Paper-Visibility': 'private' });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await request(`/api/papers/${paper.id}/bundle`)).status, 404);
  assert.equal((await request(`/api/private/files/${paper.id}/bundle`, 'GET', undefined, bob)).status, 404);
  assert.equal((await request(`/api/private/files/${paper.id}/bundle`, 'GET', undefined, alice)).status, 200);
});

test('empty/binary TXT cannot be published, and public TXT still requires consent', async () => {
  for (const content of [Buffer.from('  \n '), Buffer.from([0, 1, 2])]) {
    const hash = createHash('sha256').update(content).digest('hex');
    const response = await mf.dispatchFetch(`http://localhost/api/private/papers/${hash}`, { method: 'PUT', body: content, headers: {
      Origin: 'http://localhost', Cookie: alice, 'Content-Type': 'text/plain', 'Content-Length': String(content.length), 'X-Paper-Visibility': 'private',
      'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ title: 'bad txt', author: '', pages: 1, fileName: 'bad.txt' })),
    } });
    assert.equal(response.status, 400);
  }
  assert.equal((await upload(alice, { 'X-Paper-Visibility': 'public', 'X-Public-Upload': '' })).status, 400);
});

test('shelf remarks and password folders isolate accounts and guard files, notes, mutations', async () => {
  const req = (path, method='GET', body, headers={}) => request(`/api/private/shelf${path}`, method, body, alice, headers);
  const uploaded = await upload(alice, { 'X-Paper-Visibility': 'private' });
  const paper = (await uploaded.json()).paper;
  assert.ok(paper.id);
  assert.equal((await request(`/api/private/records/${paper.id}`, 'PUT', { version: 0, data: { ...empty(), shelf: true } }, alice)).status, 200);
  const created = await req('/folders', 'POST', { name: '资料', password: 'test-only-password' });
  assert.equal(created.status, 201);
  const { id: folder } = await created.json();
  assert.equal((await req(`/items/${paper.id}`, 'PUT', { folderId: folder, remark: '我的备注' })).status, 200);
  const locked = await (await req('')).json();
  assert.equal(locked.folders.find(f => f.id === folder).locked, true);
  assert.equal(locked.folders.find(f => f.id === folder).count, 1);
  assert.equal(locked.items.find(i => i.bookId === paper.id).remark, '');
  assert.ok(!JSON.stringify(locked).includes('password_hash'));
  assert.equal((await request('/api/private/shelf', 'GET', undefined, bob)).status, 200);
  assert.ok(!(await (await request('/api/private/shelf', 'GET', undefined, bob)).json()).folders.some(f => f.id === folder));
  assert.equal((await request(`/api/private/shelf/folders/${folder}`, 'DELETE', undefined, bob)).status, 404);
  for (const suffix of ['', '/file', '/bundle']) assert.equal((await request(`/api/private/files/${paper.id}${suffix}`, 'GET', undefined, alice)).status, 423);
  const records = await (await request('/api/private/records', 'GET', undefined, alice)).json();
  assert.ok(!records.records.some(r => r.bookId === paper.id));
  assert.ok(records.cursor > 0);
  assert.ok(!(await (await request('/api/private/uploads', 'GET', undefined, alice)).json()).papers.some(p => p.id === paper.id));
  assert.equal((await request(`/api/private/records/${paper.id}`, 'PUT', { version: 1, data: empty() }, alice)).status, 423);
  assert.equal((await req(`/items/${paper.id}`, 'PUT', { folderId: null, remark: '' })).status, 423);
  assert.equal((await req(`/folders/${folder}`, 'DELETE')).status, 423);
  assert.equal((await req(`/folders/${folder}`, 'PATCH', { name: '绕过', password: '' })).status, 423);
  assert.equal((await upload(alice, { 'X-Paper-Visibility': 'private' })).status, 423);
  for (let n=0; n<5; n++) assert.equal((await req(`/folders/${folder}/unlock`, 'POST', { password: 'incorrect' })).status, 403);
  assert.equal((await req(`/folders/${folder}/unlock`, 'POST', { password: 'test-only-password' })).status, 429);
  const db = await mf.getD1Database('DB');
  await db.prepare('UPDATE shelf_folders SET blocked_until=0 WHERE id=?').bind(folder).run();
  const unlocked = await req(`/folders/${folder}/unlock`, 'POST', { password: 'test-only-password' });
  assert.equal(unlocked.status, 200, await unlocked.clone().text());
  const headers = { 'X-Shelf-Unlock': (await unlocked.json()).token };
  const snapshot = await (await req('', 'GET', undefined, headers)).json();
  assert.equal(snapshot.folders.find(f => f.id === folder).locked, false);
  assert.equal(snapshot.items.find(i => i.bookId === paper.id).remark, '我的备注');
  assert.equal((await request(`/api/private/files/${paper.id}/file`, 'GET', undefined, alice, headers)).status, 200);
  assert.equal((await request(`/api/private/files/${paper.id}/bundle`, 'GET', undefined, alice, headers)).status, 200);
  assert.equal((await request(`/api/private/files/${paper.id}`, 'GET', undefined, bob, headers)).status, 404);
  assert.equal((await (await request(`/api/private/files/${paper.id}`, 'GET', undefined, alice, headers)).json()).title, paper.title);
  assert.ok((await (await request('/api/private/records', 'GET', undefined, alice, headers)).json()).records.some(r => r.bookId === paper.id));
  assert.equal((await req(`/folders/${folder}`, 'PATCH', { name: '资料', password: 'replacement-password' }, headers)).status, 200);
  assert.equal((await request(`/api/private/files/${paper.id}/file`, 'GET', undefined, alice, headers)).status, 423);
  const headers2 = { 'X-Shelf-Unlock': (await (await req(`/folders/${folder}/unlock`, 'POST', { password: 'replacement-password' })).json()).token };
  assert.equal((await req(`/folders/${folder}/lock`, 'POST', {}, headers2)).status, 200);
  assert.equal((await request(`/api/private/files/${paper.id}/file`, 'GET', undefined, alice, headers2)).status, 423);
  const headers3 = { 'X-Shelf-Unlock': (await (await req(`/folders/${folder}/unlock`, 'POST', { password: 'replacement-password' })).json()).token };
  assert.equal((await req(`/folders/${folder}`, 'DELETE', undefined, headers3)).status, 200);
  const final = await (await req('')).json();
  assert.ok(!final.folders.some(f => f.id === folder));
  assert.deepEqual(final.items.find(i => i.bookId === paper.id), { bookId: paper.id, folderId: null, remark: '我的备注' });
  assert.equal((await request(`/api/private/files/${paper.id}/file`, 'GET', undefined, alice)).status, 200);
  assert.ok((await (await request('/api/private/records', 'GET', undefined, alice)).json()).records.some(r => r.bookId === paper.id));
});
