const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');

function moduleFrom(file, dependencies, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: key => dependencies[key], Blob, console, ...globals }, { filename: file });
  return exports;
}
const sha256 = async bytes => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
const { readCachedPdf } = moduleFrom('src/pdf-source.ts', { './browser-compat': { sha256 } });

async function setup({ broken = false, unreadable = false, changed = false, badDownload = false } = {}) {
  const original = new TextEncoder().encode('%PDF-1.7 known content');
  const id = await sha256(original.buffer);
  let reads = 0;
  let writes = 0;
  let invalidated = false;
  class CachedBlob extends Blob {
    async arrayBuffer() {
      reads++;
      if (invalidated || unreadable) throw Error('Backing file no longer readable after write');
      return super.arrayBuffer();
    }
  }
  const blob = new CachedBlob([broken ? 'bad' : original]);
  const book = { id, blob, size: original.length, pages: 15, fileName: 'attention.pdf', title: 'attention', author: '', bilingual: false, page: 4, annotations: [{ id: 'note', text: 'Keep' }], bookmarks: [3], cover: 'existing-cover' };
  const paper = { ...book, title: changed ? 'Updated title' : book.title, hasBundle: false };
  const stored = { ...book };
  const requests = [];
  const { cachePaper } = moduleFrom('src/cloud-api.ts', {
    './storage': {
      getBook: async key => { assert.equal(key, id); return { ...stored }; },
      patchBook: async (key, patch) => { assert.equal(key, id); writes++; Object.assign(stored, patch); invalidated = true; },
      putBook: async () => { throw Error('Must preserve existing record'); },
      setting: async () => undefined,
    },
    './pdf-source': { readCachedPdf },
    './browser-compat': { sha256 },
    './pdf': { makeBook: async () => { throw Error('Existing PDF must not be reparsed for a cover'); } },
    './bundle': {},
  }, {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, arrayBuffer: async () => badDownload ? new Uint8Array(original.length).buffer : original.slice().buffer };
    },
  });
  return { cachePaper, paper, stored, requests, original, counts: () => ({ reads, writes }) };
}

test('repeated shelf opens each read once, retain verified bytes, and never fetch or rewrite unchanged PDF', async () => {
  const s = await setup();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { source } = await s.cachePaper(s.paper);
    assert.deepEqual(new Uint8Array(source.bytes), s.original);
    // Model PDF.js ownership transfer; subsequent opens must get fresh bytes.
    const workerData = structuredClone(source.bytes, { transfer: [source.bytes] });
    source.bytes = undefined;
    assert.deepEqual(new Uint8Array(workerData), s.original);
  }
  assert.deepEqual(s.counts(), { reads: 3, writes: 0 });
  assert.equal(s.requests.length, 0);
});

test('metadata rewrite invalidating a cached Blob cannot invalidate bytes already handed to reader', async () => {
  const s = await setup({ changed: true });
  const { book, source } = await s.cachePaper(s.paper);
  assert.equal(book.title, 'Updated title');
  assert.deepEqual(s.counts(), { reads: 1, writes: 1 });
  await assert.rejects(book.blob.arrayBuffer(), /Backing file/);
  assert.deepEqual(new Uint8Array(source.bytes), s.original);
  assert.deepEqual(s.stored.annotations, [{ id: 'note', text: 'Keep' }]);
  assert.equal(s.requests.length, 0);
});

test('broken cache downloads once, preserves notes/progress/cover, and next open uses repaired cache', async () => {
  const s = await setup({ broken: true });
  const { source } = await s.cachePaper(s.paper);
  assert.deepEqual(new Uint8Array(source.bytes), s.original);
  assert.equal(s.stored.page, 4);
  assert.deepEqual(s.stored.bookmarks, [3]);
  assert.equal(s.stored.cover, 'existing-cover');
  assert.deepEqual(s.stored.annotations, [{ id: 'note', text: 'Keep' }]);
  await s.cachePaper(s.paper);
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].options.cache, 'no-store');
});

test('wrong downloaded bytes never replace an existing record', async () => {
  const s = await setup({ broken: true, badDownload: true });
  await assert.rejects(s.cachePaper(s.paper), /文件校验失败/);
  assert.equal(s.counts().writes, 0);
});

test('unreadable cached Blob recovers once without losing personal records', async () => {
  const s = await setup({ unreadable: true });
  const result = await s.cachePaper(s.paper);
  assert.deepEqual(new Uint8Array(result.source.bytes), s.original);
  await s.cachePaper(s.paper);
  assert.equal(s.requests.length, 1);
  assert.equal(s.stored.page, 4);
  assert.equal(s.stored.annotations[0].text, 'Keep');
});
