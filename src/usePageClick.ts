import { useLayoutEffect, useRef, type RefObject } from 'react';

export function usePageClick(ref: RefObject<HTMLDivElement | null>, enabled: boolean, page: number, totalPages: number, turn: (direction: number) => void) {
  const turnRef = useRef(turn); turnRef.current = turn;
  const pointer = useRef<{ x: number; y: number; modified: boolean } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const setCursor = (value?: 'previous' | 'next') => {
      if (root.dataset.pageCursor === value) return;
      if (value) root.dataset.pageCursor = value;
      else delete root.dataset.pageCursor;
    };
    if (!enabled) { setCursor(); return; }
    let press: { x: number; y: number; time: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let paper: Element | null = null;
    let bounds: { left: number; right: number; paperLeft: number; paperRight: number } | null = null;
    const blocked = () => (window.visualViewport?.scale || 1) > 1.05 || !!window.getSelection()?.toString().trim();
    const excluded = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return true;
      if (target.closest('button, a, input, textarea, select, summary, [contenteditable], [role="button"]')) return true;
      const overflow = target.closest('.pdf-overflow');
      return !!overflow && overflow.scrollWidth > overflow.clientWidth + 2;
    };
    const directionAt = (x: number) => {
      if (!bounds || x < bounds.left || x >= bounds.right) return 0;
      const direction = x < bounds.paperLeft ? -1 : x >= bounds.paperRight ? 1 : 0;
      return direction && page + direction >= 1 && page + direction <= totalPages ? direction : 0;
    };
    const showCursor = (x: number, target: EventTarget | null) => {
      const direction = directionAt(x);
      setCursor(direction && !blocked() && !excluded(target) ? direction < 0 ? 'previous' : 'next' : undefined);
    };
    const refreshCursor = () => {
      const point = pointer.current;
      if (!point || point.modified) { setCursor(); return; }
      const target = document.elementFromPoint(point.x, point.y);
      if (root.contains(target)) showCursor(point.x, target);
      else setCursor();
    };
    // Cache geometry only when layout changes. Mouse movement merely checks
    // these boundaries and writes a cursor only on an actual region change.
    const measure = () => {
      const nextPaper = root.querySelector('.pdf-stage, .flow-document');
      if (paper !== nextPaper) {
        if (paper) resizeObserver.unobserve(paper);
        paper = nextPaper;
        if (paper) resizeObserver.observe(paper);
      }
      const box = root.getBoundingClientRect(), sheet = paper?.getBoundingClientRect();
      bounds = sheet && sheet.width > 0 ? { left: box.left, right: box.left + root.clientWidth, paperLeft: sheet.left, paperRight: sheet.right } : null;
      refreshCursor();
    };
    const scheduleMeasure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    const contentObserver = new MutationObserver(scheduleMeasure);
    resizeObserver.observe(root);
    contentObserver.observe(root, { childList: true, subtree: true });
    measure();
    const hover = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
      pointer.current = { x: event.clientX, y: event.clientY, modified };
      if (modified) { setCursor(); return; }
      showCursor(event.clientX, event.target);
    };
    // Cancelling a click must not briefly replace a valid gutter cursor.
    const cancel = () => { press = null; clearTimeout(timer); };
    const leave = () => { pointer.current = null; cancel(); setCursor(); };
    const down = (event: PointerEvent) => {
      cancel();
      hover(event);
      if (event.pointerType !== 'mouse' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || blocked() || excluded(event.target)) return;
      if (!directionAt(event.clientX)) return;
      press = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    };
    const move = (event: PointerEvent) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) cancel();
      hover(event);
    };
    const click = (event: MouseEvent) => {
      const start = press; press = null;
      if (!start || event.detail !== 1 || blocked() || excluded(event.target) || event.timeStamp - start.time > 500 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const direction = directionAt(event.clientX);
      if (!direction) return;
      // Leave time for a second click to select a word before changing pages.
      timer = setTimeout(() => { if (!blocked()) turnRef.current(direction); }, 300);
    };
    const selectionChanged = () => { if (blocked()) cancel(); refreshCursor(); };
    const scroll = () => { cancel(); scheduleMeasure(); };
    root.addEventListener('pointerover', hover);
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', hover);
    root.addEventListener('pointercancel', leave);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('click', click);
    root.addEventListener('dblclick', cancel);
    root.addEventListener('scroll', scroll, true);
    document.addEventListener('selectionchange', selectionChanged);
    window.addEventListener('resize', scheduleMeasure);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);
    window.visualViewport?.addEventListener('scroll', scheduleMeasure);
    return () => {
      // The next layout effect updates the cursor before paint, preserving it
      // across page turns; disabling navigation explicitly clears it above.
      cancel(); cancelAnimationFrame(frame);
      resizeObserver.disconnect(); contentObserver.disconnect();
      root.removeEventListener('pointerover', hover);
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', hover);
      root.removeEventListener('pointercancel', leave);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('click', click);
      root.removeEventListener('dblclick', cancel);
      root.removeEventListener('scroll', scroll, true);
      document.removeEventListener('selectionchange', selectionChanged);
      window.removeEventListener('resize', scheduleMeasure);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
      window.visualViewport?.removeEventListener('scroll', scheduleMeasure);
    };
  }, [ref, enabled, page, totalPages]);
}
