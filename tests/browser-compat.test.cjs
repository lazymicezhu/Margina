const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('src/browser-compat.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(crypto) {
  const exports = {};
  vm.runInNewContext(source, { exports, crypto, setTimeout });
  return exports;
}
const fallback = load({ getRandomValues: bytes => webcrypto.getRandomValues(bytes) });

test('HTTP fallback preserves SHA-256 identities at padding and chunk boundaries', async () => {
  for (const size of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 1048576, 1048577]) {
    const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 37 + 11) % 256);
    assert.equal(await fallback.sha256(bytes.buffer), createHash('sha256').update(bytes).digest('hex'), `size ${size}`);
  }
  const abc = new TextEncoder().encode('abc');
  assert.equal(await fallback.sha256(abc.buffer), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('HTTPS uses the same PDF digest as HTTP', async () => {
  const bytes = new TextEncoder().encode('Margina 阅读笔记');
  assert.equal(await load(webcrypto).sha256(bytes.buffer), await fallback.sha256(bytes.buffer));
});

test('HTTP annotation IDs retain UUID v4 version and variant bits', () => {
  const ids = Array.from({ length: 1000 }, () => fallback.randomId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
