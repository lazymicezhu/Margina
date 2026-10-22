const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, deps = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => deps[name], ...globals });
  return exports;
}
const swipe = load('src/page-swipe.ts');
function setup(enabled = true) {
  const listeners = new Map(), turns = [];
  let cleanup, selection = '';
  const viewport = { scale: 1 };
  class Target {
    constructor(kind) { this.kind = kind; }
    closest(selector) {
      if (selector === '.pdf-overflow') return this.kind === 'overflow' ? { scrollWidth: 800, clientWidth: 390 } : null;
      return this.kind === 'button' ? this : null;
    }
  }
  const root = {
    getBoundingClientRect: () => ({ left: 0, width: 390 }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type),
  };
  const { usePageSwipe } = load('src/usePageSwipe.ts', {
    react: { useRef: value => ({ current: value }), useEffect: fn => { cleanup = fn(); } },
    './page-swipe': swipe,
  }, { Element: Target, window: { visualViewport: viewport, getSelection: () => ({ toString: () => selection }) } });
  usePageSwipe({ current: root }, enabled, 2, direction => turns.push(direction));
  function event(type, x, y, time, { count = type === 'touchend' ? 0 : 1, kind, cancelable = true } = {}) {
    const point = { identifier: 1, clientX: x, clientY: y };
    let prevented = false;
    listeners.get(type)?.({ target: new Target(kind), timeStamp: time, touches: Array.from({ length: count }, () => point), changedTouches: [point], cancelable, preventDefault: () => { prevented = true; } });
    return prevented;
  }
  return { event, turns, viewport, select: value => { selection = value; }, cleanup: () => cleanup?.(), listeners };
}

test('left swipe advances once; right swipe returns once; normal tap does neither', () => {
  const s = setup();
  s.event('touchstart', 280, 400, 0);
  assert.equal(s.event('touchmove', 160, 410, 150), true);
  s.event('touchend', 110, 410, 220);
  s.event('touchstart', 100, 400, 300);
  s.event('touchmove', 220, 405, 450);
  s.event('touchend', 260, 410, 520);
  s.event('touchstart', 180, 400, 600);
  s.event('touchend', 181, 401, 700);
  assert.deepEqual(s.turns, [1, -1]);
});

test('vertical scroll stays native and cannot turn into a page flip later', () => {
  const s = setup();
  s.event('touchstart', 280, 300, 0);
  assert.equal(s.event('touchmove', 270, 350, 100), false);
  assert.equal(s.event('touchmove', 90, 360, 200), false);
  s.event('touchend', 90, 360, 300);
  assert.deepEqual(s.turns, []);
});

test('multitouch and cancellation suppress the rest of the gesture', () => {
  for (const cancelType of ['pinch', 'touchcancel']) {
    const s = setup();
    s.event('touchstart', 280, 400, 0);
    if (cancelType === 'pinch') s.event('touchmove', 250, 400, 50, { count: 2 });
    else s.event('touchcancel', 250, 400, 50);
    s.event('touchmove', 100, 400, 100);
    s.event('touchend', 80, 400, 200);
    assert.deepEqual(s.turns, []);
  }
});

test('selection, zoom, controls, horizontal overflow, edges and long presses do not turn pages', () => {
  for (const reason of ['selection', 'new-selection', 'zoom', 'button', 'overflow', 'edge', 'hold']) {
    const s = setup();
    if (reason === 'selection') s.select('Selected text');
    if (reason === 'zoom') s.viewport.scale = 2;
    s.event('touchstart', reason === 'edge' ? 10 : 280, 400, 0, { kind: reason });
    if (reason === 'new-selection') s.select('Selected during gesture');
    assert.equal(s.event('touchmove', 100, 400, reason === 'hold' ? 700 : 100), false);
    s.event('touchend', 80, 400, reason === 'hold' ? 800 : 200);
    assert.deepEqual(s.turns, [], reason);
  }
});

test('disabled gesture and unmounted reader leave no active listeners', () => {
  assert.equal(setup(false).listeners.size, 0);
  const s = setup();
  s.event('touchstart', 280, 400, 0);
  s.cleanup();
  assert.equal(s.listeners.size, 0);
  s.event('touchend', 100, 400, 200);
  assert.deepEqual(s.turns, []);
});
