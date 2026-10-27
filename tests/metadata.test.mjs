import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let db, worker, env, cookie;
let paperQueries = 0;
const id = n => n.toString(16).padStart(64, '0');
function statement(sql, args = []) {
  return {
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => { if (sql.includes('WHERE p.id IN')) paperQueries++; return { results: db.prepare(sql).all(...args) }; },
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  };
}
async function request(ids, auth = cookie, headers = {}) {
  return worker.fetch(new Request(`http://localhost/api/account/metadata?ids=${ids.join(',')}`, { headers: { ...(auth ? { Cookie: auth } : {}), ...headers } }), env);
}
before(async () => {
  db = new DatabaseSync(':memory:'); db.exec(await readFile('server/schema.sql', 'utf8'));
  const bundled = await build({ entryPoints: ['server/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  worker = (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)).default;
  env = { ENVIRONMENT: 'local', LOCAL_DEV_AUTH: 'true', DB: { prepare: statement }, FILES: { get() { throw Error('Metadata must not read file storage'); } } };
  const login = await worker.fetch(new Request('http://localhost/api/dev/login', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: '{"name":"bob"}' }), env);
  cookie = login.headers.get('set-cookie').split(';')[0];
  for (let n = 1; n <= 45; n++) db.prepare('INSERT INTO papers(id,title,file_name,size,pages,pdf_key,owner,created,updated,visibility,removed) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id(n), `Book ${n}`, 'fixture.pdf', 100, 1, `files/${n}.pdf`, n === 3 ? 'local-alice' : 'local-bob', 1, 1, [2, 3, 5].includes(n) ? 'private' : 'public', n === 4 ? 1 : 0);
  db.prepare('INSERT INTO shelf_folders(id,user_id,name,password_hash,created,updated) VALUES(?,?,?,?,?,?)').run('locked', 'local-bob', 'Locked', 'hash', 1, 1);
  for (const n of [5, 6]) db.prepare('INSERT INTO shelf_items(user_id,book_id,folder_id) VALUES(?,?,?)').run('local-bob', id(n), 'locked');
});
after(() => db?.close());
test('one metadata query returns public and own private books without file reads or private-data leakage', async () => {
  paperQueries = 0;
  const response = await request([1, 2, 3, 4, 5, 6, 99].map(id));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(paperQueries, 1);
  assert.deepEqual(data.papers.map(p => p.id), [id(1), id(2)]);
  assert.deepEqual(data.unavailable, [id(3), id(4), id(99)]);
  assert.deepEqual(data.locked, [id(5), id(6)]);
  assert.equal(data.papers[1].privateOwner, 'local-bob');
  assert.equal(JSON.stringify(data).includes('Book 3'), false);
  assert.equal(JSON.stringify(data).includes('Book 5'), false);
});
test('metadata batches enforce authentication, owner identity, valid IDs and the 40-book bound', async () => {
  assert.equal((await request([id(1)], '')).status, 401);
  assert.equal((await request([id(1)], cookie, { 'X-Margina-User': 'local-alice' })).status, 401);
  assert.equal((await request([])).status, 400);
  assert.equal((await request(['invalid'])).status, 400);
  assert.equal((await request(Array.from({ length: 41 }, (_, n) => id(n + 1)))).status, 400);
  assert.equal((await request(Array.from({ length: 40 }, (_, n) => id(n + 1)))).status, 200);
});
const compiled = await build({ entryPoints: ['src/paper-metadata.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { resolveMetadata, cachedMetadata, metadataKey } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
test('a slow first batch does not block later metadata; at most two batches run, failures remain retryable', async () => {
  let release; const slow = new Promise(resolve => { release = resolve; });
  let active = 0, peak = 0, calls = 0; const received = [];
  const work = resolveMetadata(Array.from({ length: 85 }, (_, n) => id(n)), async batch => {
    active++; peak = Math.max(peak, active); calls++;
    try { if (batch[0] === id(0)) await slow; if (batch[0] === id(80)) throw Error('Offline'); return { papers: [], unavailable: batch, locked: [] }; }
    finally { active--; }
  }, (batch, result) => received.push({ first: batch[0], ok: !!result }), new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received, [{ first: id(40), ok: true }, { first: id(80), ok: false }]);
  release(); await work; assert.equal(calls, 3); assert.equal(peak, 2);
});
test('cancelled account loads cannot deliver late results; metadata cache is scoped and filtered', async () => {
  const controller = new AbortController(); let received = false;
  await resolveMetadata([id(1)], async () => { controller.abort(); return { papers: [], unavailable: [], locked: [] }; }, () => { received = true; }, controller.signal);
  assert.equal(received, false);
  assert.notEqual(metadataKey('alice'), metadataKey('bob'));
  assert.deepEqual(cachedMetadata({ a: { id: 'a', title: 'Visible' }, b: { id: 'b', title: 'Locked' } }, ['a']), { a: { id: 'a', title: 'Visible' } });
  assert.deepEqual(cachedMetadata({ a: { id: 'wrong', title: 'Bad' } }, ['a']), {});
});
