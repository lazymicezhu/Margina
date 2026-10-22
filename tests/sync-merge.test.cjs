const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/sync-merge.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exports_ });
const merge = (...args) => JSON.parse(JSON.stringify(exports_.mergeReading(...args)));
const empty = () => ({ shelf: false, starred: false, page: 1, opened: 0, bookmarks: [], annotations: [] });
const note = (text, id = 'note') => ({ id, page: 1, text, quote: '', rects: [], color: 'yellow', language: 'en', created: 1, updated: 2 });

test('independent notes and bookmarks merge without losing either device', () => {
  const merged = merge(empty(), { ...empty(), annotations: [note('one', 'a')], bookmarks: [1] }, { ...empty(), annotations: [note('two', 'b')], bookmarks: [2] });
  assert.deepEqual(merged.annotations.map(n => n.text).sort(), ['one', 'two']);
  assert.deepEqual(merged.bookmarks, [1, 2]);
});
test('same note concurrently edited keeps a deterministic conflict copy', () => {
  const base = { ...empty(), annotations: [note('base')] };
  const local = { ...base, annotations: [note('local')] };
  const remote = { ...base, annotations: [note('remote')] };
  const merged = merge(base, local, remote);
  assert.equal(merged.annotations.length, 2);
  assert.ok(merged.annotations.some(n => n.text === 'remote'));
  assert.ok(merged.annotations.some(n => n.text.includes('local')));
  assert.deepEqual(merge(base, local, remote), merged);
});
test('delete propagates when unchanged elsewhere, concurrent edit survives delete', () => {
  const base = { ...empty(), annotations: [note('base')] };
  assert.equal(merge(base, empty(), base).annotations.length, 0);
  assert.equal(merge(base, base, empty()).annotations.length, 0);
  assert.equal(merge(base, empty(), { ...base, annotations: [note('edited')] }).annotations[0].text, 'edited');
});
test('shelf removal is not undone by unrelated offline notes', () => {
  const base = { ...empty(), shelf: true, bookmarks: [1, 2] };
  const result = merge(base, { ...base, annotations: [note('offline')] }, { ...base, shelf: false, bookmarks: [2] });
  assert.equal(result.shelf, false); assert.deepEqual(result.bookmarks, [2]); assert.equal(result.annotations.length, 1);
});
test('newer reading can move backwards and in-flight edits are preserved', () => {
  const base = { ...empty(), page: 10, opened: 100 };
  assert.equal(merge(base, { ...base, page: 2, opened: 200 }, base).page, 2);
  assert.equal(merge(base, { ...base, annotations: [note('during upload')] }, base).annotations.length, 1);
});
