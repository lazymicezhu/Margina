import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

// Run the real Worker with SQLite and an in-memory object store. No HTTP server
// or development service is started by this suite.
let db, worker, env, alice, bob, folder;
const objects = new Map();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('%PDF-1.4\nSynthetic folder test\n%%EOF');
const paperId = hash(bytes);
function statement(sql, args = []) {
  return {
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  };
}
async function request(path, method = 'GET', body, cookie, headers = {}) {
  return worker.fetch(new Request(`http://localhost${path}`, {
    method, headers: { ...(method !== 'GET' ? { Origin: 'http://localhost' } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
}
async function upload(cookie, folderId, visibility = 'public', content = bytes) {
  return worker.fetch(new Request(`http://localhost/api/account/papers/${hash(content)}`, {
    method: 'PUT', body: content,
    headers: { Origin: 'http://localhost', Cookie: cookie, 'Content-Type': 'application/pdf', 'Content-Length': String(content.length),
      'X-Public-Upload': 'confirmed', 'X-Paper-Visibility': visibility, ...(folderId ? { 'X-Catalog-Folder': folderId } : {}),
      'X-Paper-Metadata': encodeURIComponent(JSON.stringify({ title: 'Folder fixture', author: 'Test', fileName: 'test.pdf', pages: 1 })) },
  }), env);
}
async function folders(cookie) { return (await (await request('/api/catalog/folders', 'GET', undefined, cookie)).json()).folders; }
async function list(query = '') { return (await (await request(`/api/catalog${query}`)).json()).papers; }
before(async () => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(await readFile('server/schema.sql', 'utf8'));
  // The additive migration is safe on both freshly initialized and existing DBs.
  db.exec(await readFile('server/migrations/0004-catalog-folders.sql', 'utf8'));
  const bundled = await build({ entryPoints: ['server/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  worker = (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)).default;
  env = { ENVIRONMENT: 'local', LOCAL_DEV_AUTH: 'true', DB: { prepare: statement, async batch(statements) {
    db.exec('BEGIN');
    try { const result = []; for (const s of statements) result.push(await s.run()); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } }, FILES: {
    async put(key, body, options) {
      const content = Buffer.from(await new Response(body).arrayBuffer());
      if (options.sha256) assert.equal(hash(content), options.sha256);
      objects.set(key, content);
    },
    async get(key, options) {
      let content = objects.get(key); if (!content) return null;
      if (options?.range) content = content.subarray(options.range.offset, options.range.offset + options.range.length);
      return { text: async () => content.toString(), body: content, size: content.length, httpEtag: 'fixture' };
    },
    async delete(key) { objects.delete(key); },
  } };
  alice = (await request('/api/dev/login', 'POST', { name: 'alice' })).headers.get('set-cookie').split(';')[0];
  bob = (await request('/api/dev/login', 'POST', { name: 'bob' })).headers.get('set-cookie').split(';')[0];
});
after(() => db?.close());

test('public folders hide owner identity; creation and management enforce authentication and ownership', async () => {
  assert.equal((await request('/api/account/catalog/folders', 'POST', { name: 'Test' })).status, 401);
  assert.equal((await request('/api/account/catalog/folders', 'POST', { name: '  ' }, bob)).status, 400);
  const created = await request('/api/account/catalog/folders', 'POST', { name: '  机器学习  ' }, bob);
  assert.equal(created.status, 201, await created.clone().text()); folder = (await created.json()).id;
  const guest = await folders();
  assert.deepEqual(guest, [{ id: folder, name: '机器学习', count: 0, canManage: false }]);
  assert.equal((await folders(bob))[0].canManage, true);
  assert.equal((await folders(alice))[0].canManage, true);
  const adminFolder = (await (await request('/api/account/catalog/folders', 'POST', { name: '管理分类' }, alice)).json()).id;
  for (const method of ['PATCH', 'DELETE']) assert.equal((await request(`/api/account/catalog/folders/${adminFolder}`, method, { name: '改名' }, bob)).status, 403);
  assert.equal((await request(`/api/account/catalog/folders/${folder}`, 'PATCH', { name: '论文' }, bob)).status, 200);
});

test('uploads, root listing, scoped search and duplicates preserve public classification', async () => {
  const response = await upload(bob, folder);
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal((await response.json()).paper.catalogFolderId, folder);
  assert.equal((await list('?folder=')).length, 0);
  assert.equal((await list(`?folder=${folder}`))[0].id, paperId);
  assert.equal((await list(`?folder=${folder}&q=fixture`)).length, 1);
  assert.equal((await list(`?folder=${folder}&q=absent`)).length, 0);
  assert.equal((await list('?q=fixture')).length, 1);
  assert.equal((await folders())[0].count, 1);
  const duplicate = await upload(alice);
  assert.equal((await duplicate.json()).paper.catalogFolderId, folder);
  assert.equal((await (await request(`/api/papers/${paperId}`)).json()).catalogFolderId, folder);
  assert.equal((await (await request('/api/account/uploads', 'GET', undefined, bob)).json()).papers[0].catalogFolderId, folder);
});

test('invalid destinations and private uploads cannot leak into public folders or leave stored objects', async () => {
  const before = objects.size;
  assert.equal((await upload(bob, 'missing')).status, 404);
  assert.equal((await upload(bob, folder, 'private')).status, 400);
  assert.equal(objects.size, before);
  const privateUpload = await upload(bob, undefined, 'private');
  assert.equal(privateUpload.status, 201);
  const privateId = (await privateUpload.json()).paper.id;
  assert.equal((await request(`/api/account/catalog/items/${privateId}`, 'PUT', { folderId: folder }, bob)).status, 404);
  assert.equal((await list()).length, 1);
  assert.equal((await folders())[0].count, 1);
  assert.equal((await request('/api/catalog?folder=missing')).status, 404);
});

test('only document owner/admin may move public documents, including moving back to root', async () => {
  const adminBytes = Buffer.from('%PDF-1.4\nAdmin fixture\n%%EOF');
  const adminId = hash(adminBytes);
  assert.equal((await upload(alice, folder, 'public', adminBytes)).status, 201);
  assert.equal((await request(`/api/account/catalog/items/${adminId}`, 'PUT', { folderId: null }, bob)).status, 403);
  assert.equal((await request(`/api/account/catalog/items/${paperId}`, 'PUT', { folderId: null }, bob)).status, 200);
  assert.equal((await list('?folder=')).length, 1);
  assert.equal((await request(`/api/account/catalog/items/${paperId}`, 'PUT', { folderId: folder }, bob)).status, 200);
  assert.equal((await request(`/api/account/catalog/items/${paperId}`, 'PUT', { folderId: 'missing' }, bob)).status, 404);
});

test('folder pagination neither duplicates nor drops documents; withdrawal updates counts', async () => {
  const source = db.prepare('SELECT * FROM papers WHERE id = ?').get(paperId);
  const insert = db.prepare('INSERT INTO papers(id,title,file_name,size,pages,pdf_key,owner,created,updated) VALUES(?,?,?,?,?,?,?,?,?)');
  for (let i = 1; i <= 45; i++) {
    const id = hash(`pagination-${i}`);
    insert.run(id, 'Paged fixture', 'fixture.pdf', 10, 1, source.pdf_key, 'local-bob', i, i);
    db.prepare('INSERT INTO catalog_items VALUES(?,?)').run(id, folder);
  }
  const first = await (await request(`/api/catalog?folder=${folder}`)).json();
  const second = await (await request(`/api/catalog?folder=${folder}&offset=40`)).json();
  assert.equal(first.papers.length, 40); assert.equal(first.more, true);
  assert.equal(second.papers.length, 7); assert.equal(second.more, false);
  assert.equal(new Set([...first.papers, ...second.papers].map(p => p.id)).size, 47);
  assert.equal((await request(`/api/account/papers/${paperId}`, 'DELETE', undefined, bob)).status, 200);
  assert.equal((await folders())[0].count, 46);
});

test('deleting a folder moves documents to root and preserves files and reading notes', async () => {
  const data = JSON.stringify({ shelf: true, annotations: [{ text: 'keep note' }] });
  db.prepare('INSERT INTO reading(user_id,book_id,version,data) VALUES(?,?,?,?)').run('local-bob', paperId, 1, data);
  const before = objects.size;
  assert.equal((await request(`/api/account/catalog/folders/${folder}`, 'DELETE', undefined, bob)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalog_items WHERE folder_id = ?').get(folder).n, 0);
  assert.equal(db.prepare('SELECT data FROM reading WHERE book_id = ?').get(paperId).data, data);
  assert.equal(objects.size, before);
  assert.equal((await list('?folder=')).length, 40);
});

test('a destination deleted during upload rolls back publication and releases the uploaded object', async () => {
  const target = (await (await request('/api/account/catalog/folders', 'POST', { name: 'Race fixture' }, bob)).json()).id;
  const originalPut = env.FILES.put;
  const content = Buffer.from('%PDF-1.4\nDeleted destination fixture\n%%EOF');
  const before = objects.size;
  env.FILES.put = async (...args) => {
    await originalPut(...args);
    db.prepare('DELETE FROM catalog_folders WHERE id = ?').run(target);
  };
  try {
    assert.equal((await upload(bob, target, 'public', content)).status, 503);
    assert.equal(db.prepare('SELECT id FROM papers WHERE id = ?').get(hash(content)), undefined);
    assert.equal(objects.size, before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM storage_allocations WHERE object_key LIKE ?").get(`papers/${hash(content)}/%`).n, 0);
  } finally { env.FILES.put = originalPut; }
});

test('catalog organization capability is per-account and admin listing carries actual folder placement', async () => {
  const target = (await (await request('/api/account/catalog/folders', 'POST', { name: '入口测试' }, bob)).json()).id;
  const content = Buffer.from('%PDF-1.4\nOrganization entry fixture\n%%EOF');
  const id = hash(content);
  assert.equal((await upload(bob, target, 'public', content)).status, 201);
  const catalogFor = async cookie => (await (await request(`/api/catalog?folder=${target}`, 'GET', undefined, cookie)).json()).papers[0];
  assert.equal((await catalogFor()).canOrganize, false);
  assert.equal((await catalogFor(bob)).canOrganize, true);
  assert.equal((await catalogFor(alice)).canOrganize, true);
  assert.equal((await catalogFor()).owner, undefined);
  const adminRows = (await (await request('/api/account/admin/papers?q=Folder%20fixture', 'GET', undefined, alice)).json()).papers;
  const row = adminRows.find(p => p.id === id);
  assert.equal(row.catalogFolderId, target); assert.equal(row.catalogFolderName, '入口测试'); assert.equal(row.canOrganize, true);
  assert.equal((await request('/api/account/admin/papers', 'GET', undefined, bob)).status, 403);
  assert.equal((await request(`/api/account/catalog/items/${id}`, 'PUT', { folderId: null }, alice)).status, 200);
  assert.equal((await (await request(`/api/papers/${id}`)).json()).catalogFolderId, null);
  await request(`/api/account/papers/${id}`, 'DELETE', undefined, bob);
  assert.equal((await request(`/api/account/catalog/items/${id}`, 'PUT', { folderId: target }, bob)).status, 404);
  assert.equal((await request(`/api/account/catalog/items/${id}`, 'PUT', { folderId: target }, alice)).status, 200);
  const withdrawn = (await (await request('/api/account/admin/papers?status=withdrawn', 'GET', undefined, alice)).json()).papers.find(p => p.id === id);
  assert.equal(withdrawn.catalogFolderName, '入口测试'); assert.equal(withdrawn.canOrganize, true);
  db.prepare('UPDATE papers SET removed = 3 WHERE id = ?').run(id);
  assert.equal((await request(`/api/account/catalog/items/${id}`, 'PUT', { folderId: null }, alice)).status, 404);
});

test('a non-owner sees no global classification action for another account document', async () => {
  const content = Buffer.from('%PDF-1.4\nAnother owner capability fixture\n%%EOF');
  const id = hash(content);
  await upload(alice, undefined, 'public', content);
  const papers = (await (await request('/api/catalog', 'GET', undefined, bob)).json()).papers;
  assert.equal(papers.find(p => p.id === id).canOrganize, false);
  assert.equal((await request(`/api/account/catalog/items/${id}`, 'PUT', { folderId: null }, bob)).status, 403);
});
