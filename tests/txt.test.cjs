const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/txt.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsForTest, TextDecoder, Uint8Array });
const { parseTxt, TXT_MAX_BYTES } = exportsForTest;
const data = text => new TextEncoder().encode(text).buffer;
test('UTF-8 pagination preserves every character, line break, emoji and page boundary across rereads', () => {
  const text = ('第一章\r\n\r\n' + '正文🙂abc'.repeat(300) + '\n').repeat(5);
  const pages = parseTxt(data('\uFEFF' + text));
  assert.ok(pages.length > 1);
  assert.equal(pages.join(''), text.replace(/\r\n/g, '\n'));
  for (const p of pages) assert.ok(!/[\uD800-\uDBFF]$/.test(p));
  assert.deepEqual(parseTxt(data(text)), pages);
});
test('UTF-16 and GB18030 Chinese text decode correctly', () => {
  const utf16 = Buffer.from('\uFEFF中文文本', 'utf16le');
  assert.equal(parseTxt(utf16.buffer.slice(utf16.byteOffset, utf16.byteOffset + utf16.byteLength)).join(''), '中文文本');
  assert.equal(parseTxt(Uint8Array.from([0xd6,0xd0,0xce,0xc4]).buffer).join(''), '中文');
});
test('empty, binary and oversized input are rejected', () => {
  assert.throws(() => parseTxt(data(' \n ')));
  assert.throws(() => parseTxt(Uint8Array.from([0,1,2]).buffer));
  assert.throws(() => parseTxt(new ArrayBuffer(TXT_MAX_BYTES + 1)));
});
