const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup(enabled = true) {
  const listeners = new Map(), documentListeners = new Map(), turns = [], timers = new Map();
  let cleanup, selected = '', clock = 0, cursorWrites = 0, geometryReads = 0, currentTarget;
  const frames = new Map(), windowListeners = new Map();
  const viewport = { scale: 1, addEventListener() {}, removeEventListener() {} };
  class Observer { observe() {} unobserve() {} disconnect() {} }
  class Target {
    constructor(kind) { this.kind = kind; }
    closest(selector) {
      if (selector === '.pdf-overflow') return this.kind === 'overflow' ? { scrollWidth: 900, clientWidth: 600 } : null;
      return this.kind === 'control' ? this : null;
    }
  }
  const root = {
    clientWidth: 600,
    dataset: new Proxy({}, { set(target, key, value) { cursorWrites++; target[key] = value; return true; }, deleteProperty(target, key) { cursorWrites++; delete target[key]; return true; } }),
    contains: target => target instanceof Target,
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 260, right: 540, width: 280 }) }),
    getBoundingClientRect: () => { geometryReads++; return { left: 100, width: 615 }; },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/usePageClick.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports, Element: Target, ResizeObserver: Observer, MutationObserver: Observer,
    requestAnimationFrame: fn => { frames.set(++clock, fn); return clock; }, cancelAnimationFrame: id => frames.delete(id),
    require: () => ({ useRef: value => ({ current: value }), useLayoutEffect: fn => { cleanup = fn(); } }),
    window: { addEventListener: (name, fn) => windowListeners.set(name, fn), removeEventListener: name => windowListeners.delete(name), visualViewport: viewport, getSelection: () => ({ toString: () => selected }) },
    document: { elementFromPoint: () => currentTarget, addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) },
    setTimeout: fn => { timers.set(++clock, fn); return clock; }, clearTimeout: id => timers.delete(id),
  });
  exports.usePageClick({ current: root }, enabled, 2, 5, direction => turns.push(direction));
  const event = (type, props = {}) => { currentTarget = new Target(props.kind); listeners.get(type)?.({ target: currentTarget, pointerType: 'mouse', button: 0, clientX: 550, clientY: 200, timeStamp: 100, detail: 1, ...props }); };
  return { event, turns, viewport, listeners, documentListeners, cursor: () => root.dataset.pageCursor, cursorWrites: () => cursorWrites, geometryReads: () => geometryReads, cleanup: () => cleanup?.(), select(value) { selected = value; documentListeners.get('selectionchange')?.(); }, flush() { for (const fn of frames.values()) fn(); frames.clear(); for (const fn of timers.values()) fn(); timers.clear(); } };
}

test('mouse clicks in paper gutters turn pages after the double-click grace period', () => {
  const s = setup();
  s.event('pointerdown'); s.event('click');
  assert.deepEqual(s.turns, []); s.flush(); assert.deepEqual(s.turns, [1]);
  s.event('pointerdown', { clientX: 200 }); s.event('click', { clientX: 200 }); s.flush();
  assert.deepEqual(s.turns, [1, -1]);
});

test('selection, dragging, double click, scrolling, controls, zoom and touch never turn pages', () => {
  for (const reason of ['selection', 'new-selection', 'drag', 'double', 'scroll', 'control', 'overflow', 'zoom', 'touch', 'right-button', 'modifier', 'hold', 'scrollbar', 'cancel', 'leave']) {
    const s = setup(), props = {};
    if (reason === 'selection') s.select('selected');
    if (reason === 'zoom') s.viewport.scale = 2;
    if (reason === 'touch') props.pointerType = 'touch';
    if (reason === 'right-button') props.button = 2;
    if (reason === 'modifier') props.shiftKey = true;
    if (reason === 'control' || reason === 'overflow') props.kind = reason;
    if (reason === 'scrollbar') props.clientX = 705;
    s.event('pointerdown', props);
    if (reason === 'drag') { s.event('pointermove', { clientX: 580 }); s.event('pointermove', { clientX: 550 }); }
    if (reason === 'cancel') s.event('pointercancel');
    if (reason === 'leave') s.event('pointerleave');
    s.event('click', { ...props, timeStamp: reason === 'hold' ? 1000 : 200 });
    if (reason === 'new-selection') s.select('new text');
    if (reason === 'double') { s.event('pointerdown'); s.event('click', { detail: 2 }); s.event('dblclick'); }
    if (reason === 'scroll') s.event('scroll');
    s.flush(); assert.deepEqual(s.turns, [], reason);
  }
});

test('disabled or unmounted reader removes listeners and cancels pending page changes', () => {
  assert.equal(setup(false).listeners.size, 0);
  const s = setup(); s.event('pointerdown'); s.event('click'); s.cleanup(); s.flush();
  assert.equal(s.listeners.size, 0); assert.equal(s.documentListeners.size, 0); assert.deepEqual(s.turns, []);
});


test('paper interior and drags starting on paper never turn pages', () => {
  for (const x of [260, 300, 400, 539]) {
    const s = setup();
    s.event('pointerdown', { clientX: x });
    s.event('click', { clientX: x }); s.flush();
    assert.deepEqual(s.turns, []);
  }
  const s = setup();
  s.event('pointerdown', { clientX: 539 });
  s.event('click', { clientX: 541 }); s.flush();
  assert.deepEqual(s.turns, []);
});


test('movement within one gutter and a single click do not rewrite the cursor or remeasure layout', () => {
  const s = setup();
  s.event('pointerover');
  assert.equal(s.cursor(), 'next');
  const writes = s.cursorWrites(), reads = s.geometryReads();
  for (let i = 0; i < 100; i++) s.event('pointermove', { clientX: 550 + i });
  s.event('pointerdown'); s.event('pointerup'); s.event('click'); s.flush();
  assert.equal(s.cursorWrites(), writes);
  assert.equal(s.geometryReads(), reads);
  assert.equal(s.cursor(), 'next');
  assert.deepEqual(s.turns, [1]);
  s.event('pointermove', { clientX: 400 });
  assert.equal(s.cursor(), undefined);
  assert.equal(s.cursorWrites(), writes + 1);
  s.event('pointermove', { clientX: 390 });
  assert.equal(s.cursorWrites(), writes + 1);
});

test('selection and leaving the reader clear the cursor only once', () => {
  const s = setup();
  s.event('pointerover'); s.select('selected text');
  assert.equal(s.cursor(), undefined);
  const writes = s.cursorWrites();
  s.event('pointermove'); s.event('pointerleave');
  assert.equal(s.cursorWrites(), writes);
});
