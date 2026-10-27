const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/reader-navigation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsModule });
function setup() {
  const stack = [{ external: true }, { otherState: 'preserved' }];
  let index = 1, pop;
  const changes = [];
  const history = {
    get state() { return stack[index]; },
    replaceState(state) { stack[index] = structuredClone(state); },
    pushState(state) { stack.splice(++index); stack.push(structuredClone(state)); },
    back() { if (index) { index--; pop?.(); } },
    forward() { if (index + 1 < stack.length) { index++; pop?.(); } },
  };
  const host = { history, addEventListener(_, fn) { pop = fn; }, removeEventListener() { pop = null; } };
  const nav = exportsModule.createReaderNavigation(host, e => changes.push(e));
  return { nav, history, changes, stack, index: () => index };
}
test('browser back returns to the exact list; forward reuses the reader entry', () => {
  const s = setup(), origin = { view: 'catalog', folder: 'folder1', query: 'search', scroll: 1450, paper: 'book' };
  const ticket = s.nav.enter(origin);
  assert.equal(s.stack.length, 3);
  assert.equal(s.history.state.otherState, 'preserved');
  assert.equal(JSON.stringify(s.history.state).includes('search'), false);
  s.history.back();
  assert.equal(s.changes.at(-1).kind, 'list');
  assert.equal(s.changes.at(-1).data, origin);
  assert.equal(s.nav.isCurrent(ticket), false);
  s.history.forward();
  assert.equal(s.changes.at(-1).kind, 'reader');
  assert.equal(s.nav.isCurrent(ticket), true);
  assert.equal(s.stack.length, 3);
});
test('reader button consumes its entry; repeated open/back does not accumulate phantom readers', () => {
  const s = setup();
  for (let i = 0; i < 5; i++) {
    s.nav.enter({ paper: i }); s.nav.back();
    assert.equal(s.index(), 1);
    assert.equal(s.stack.length, 3);
  }
  s.nav.back(); // A second reader-button click never leaves the site.
  assert.equal(s.index(), 1);
  s.history.back(); // The browser itself can still leave the site normally.
  assert.equal(s.index(), 0);
});
test('account reset invalidates old forward entries and outstanding loads', () => {
  const s = setup();
  const ticket = s.nav.enter({ owner: 'alice', paper: 'private' });
  s.history.back(); s.nav.reset(); s.history.forward();
  assert.equal(s.nav.isCurrent(ticket), false);
  assert.equal(s.changes.at(-1).kind, 'list');
  assert.equal(s.changes.at(-1).data, undefined);
});
test('a reload does not trust history markers from an earlier app instance', () => {
  const s = setup();
  s.nav.enter({ paper: 'old' });
  s.nav.dispose();
  assert.equal(s.nav.isCurrent(-1), false);
  // A new controller must establish its own list without adding an entry.
  const changes = [];
  const nav = exportsModule.createReaderNavigation({ history: s.history, addEventListener() {}, removeEventListener() {} }, e => changes.push(e));
  assert.equal(s.stack.length, 3);
  nav.back();
  assert.equal(s.index(), 2);
});

test('rapid reader-button clicks schedule only one asynchronous browser traversal', () => {
  let calls = 0, state = null;
  const host = { history: {
    get state() { return state; },
    replaceState(value) { state = value; }, pushState(value) { state = value; },
    back() { calls++; },
  }, addEventListener() {}, removeEventListener() {} };
  const nav = exportsModule.createReaderNavigation(host, () => {});
  nav.enter({ paper: 'book' });
  nav.back(); nav.back(); nav.back();
  assert.equal(calls, 1);
});
