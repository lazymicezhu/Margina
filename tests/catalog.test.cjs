const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function moduleFrom(file, dependencies, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: key => dependencies[key], ...globals }, { filename: file });
  return exports;
}
const { validateBundle } = moduleFrom('src/bundle.ts', {});
const hash = 'a'.repeat(64);
const note = { id: 'existing-note', text: 'Keep this thought' };
const bundle = { format: 'yuejian-babeldoc-v1', pdfSha256: hash, title: 'Updated paper', author: '', pageCount: 4, glossary: {}, segments: [{ id: 'p', page: 1, source: 'English', zh: '中文' }] };

function setup(data = bundle) {
  const settings = new Map();
  const book = { id: hash, title: 'Old title', author: 'Original author', pages: 4, page: 3, annotations: [note], bookmarks: [2], starred: true };
  const stored = structuredClone(book);
  const requests = [];
  const catalog = { revision: 'revision-2', items: [{ name: 'paper.pdf', pdf: '/private.pdf', bundle: '/bundle.json', sha256: hash }] };
  const storage = {
    setting: async (key, value) => value === undefined ? settings.get(key) : settings.set(key, value),
    patchBook: async (id, patch) => Object.assign(stored, patch),
    putBook: async () => { throw Error('Existing book must not be replaced'); },
  };
  const { importLocalCatalog } = moduleFrom('src/catalog.ts', {
    './bundle': { validateBundle }, './storage': storage,
    './pdf': { makeBook: async () => { throw Error('Existing PDF must not be reimported'); } },
  }, {
    fetch: async url => {
      requests.push(url);
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => url.includes('catalog') ? catalog : data };
    },
  });
  return { importLocalCatalog, book, stored, settings, requests };
}

test('bundle updates preserve notes, progress, bookmarks, stars and newer stored annotations', async () => {
  const s = setup();
  s.stored.annotations.push({ id: 'newer-note', text: 'Saved after initial library read' });
  await s.importLocalCatalog([s.book], () => {});
  assert.equal(s.stored.title, 'Updated paper');
  assert.equal(s.stored.author, 'Original author');
  assert.deepEqual(s.stored.annotations.map(n => n.id), ['existing-note', 'newer-note']);
  assert.deepEqual(s.stored.bookmarks, [2]);
  assert.equal(s.stored.page, 3);
  assert.equal(s.stored.starred, true);
  assert.equal(s.settings.get('localCatalogRevision'), 'revision-2');
  assert.deepEqual(s.requests, ['/samples/catalog.json', '/bundle.json']);
});

test('same catalog revision does not reimport a removed paper', async () => {
  const s = setup();
  s.settings.set('localCatalogRevision', 'revision-2');
  await s.importLocalCatalog([], () => {});
  assert.deepEqual(s.requests, ['/samples/catalog.json']);
});

test('mismatched bundle never updates book or marks revision complete', async () => {
  const s = setup({ ...bundle, pdfSha256: 'b'.repeat(64) });
  await assert.rejects(s.importLocalCatalog([s.book], () => {}), /不匹配/);
  assert.equal(s.stored.title, 'Old title');
  assert.equal(s.settings.has('localCatalogRevision'), false);
});
