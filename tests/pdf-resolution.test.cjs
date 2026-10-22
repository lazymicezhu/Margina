const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/pdf-resolution.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api });

test('3x and 4x phone displays use their native resolution', () => {
  for (const density of [1, 2, 3, 4]) {
    const size = api.pdfBitmapSize(370, 960, density);
    assert.equal(size.width, 370 * density);
    assert.equal(size.height, 960 * density);
  }
});

test('pinch zoom increases detail without changing layout dimensions', () => {
  const size = api.pdfBitmapSize(370, 480, 3 * 2);
  assert.equal(size.width, 2220);
  assert.equal(size.height, 2880);
  assert.equal(size.width / size.scaleX, 370);
  assert.equal(size.height / size.scaleY, 480);
});

test('large pages and zooms stay within bitmap memory and side budgets', () => {
  for (const [width, height, density] of [[1110, 2880, 12], [300, 20000, 3], [20000, 300, 4], [10000, 10000, 1]]) {
    const size = api.pdfBitmapSize(width, height, density);
    assert.ok(size.width * size.height <= api.MAX_PDF_PIXELS);
    assert.ok(size.width <= api.MAX_PDF_SIDE && size.height <= api.MAX_PDF_SIDE);
    assert.ok(size.width > 0 && size.height > 0);
    assert.ok(Math.abs(size.width - width * size.scaleX) < 0.001);
    assert.ok(Math.abs(size.height - height * size.scaleY) < 0.001);
  }
});
