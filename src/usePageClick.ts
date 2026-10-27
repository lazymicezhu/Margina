import { useEffect, useRef, type RefObject } from 'react';

export function usePageClick(ref: RefObject<HTMLDivElement | null>, enabled: boolean, page: number, totalPages: number, turn: (direction: number) => void) {
  const turnRef = useRef(turn); turnRef.current = turn;
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let press: { x: number; y: number; time: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const blocked = () => (window.visualViewport?.scale || 1) > 1.05 || !!window.getSelection()?.toString().trim();
    const excluded = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return true;
      if (target.closest('button, a, input, textarea, select, summary, [contenteditable], [role="button"]')) return true;
      const overflow = target.closest('.pdf-overflow');
      return !!overflow && overflow.scrollWidth > overflow.clientWidth + 2;
    };
    const clearCursor = () => { delete root.dataset.pageCursor; };
    const directionAt = (x: number) => {
      const box = root.getBoundingClientRect();
      if (x < box.left || x >= box.left + root.clientWidth) return 0;
      const paper = root.querySelector('.pdf-stage, .flow-document')?.getBoundingClientRect();
      if (!paper || paper.width <= 0) return 0;
      // Use the actual paper edges, so text and whitespace inside the page
      // keep their native selection behavior at every window size.
      const direction = x < paper.left ? -1 : x >= paper.right ? 1 : 0;
      if (!direction) return 0;
      return page + direction >= 1 && page + direction <= totalPages ? direction : 0;
    };
    const showCursor = (x: number, target: EventTarget | null) => {
      const direction = directionAt(x);
      if (!direction || blocked() || excluded(target)) { clearCursor(); return; }
      root.dataset.pageCursor = direction < 0 ? 'previous' : 'next';
    };
    const hover = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointer.current = { x: event.clientX, y: event.clientY };
      if (event.buttons || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { clearCursor(); return; }
      showCursor(event.clientX, event.target);
    };
    const cancel = () => { press = null; clearTimeout(timer); clearCursor(); };
    const leave = () => { pointer.current = null; cancel(); };
    const down = (event: PointerEvent) => {
      cancel();
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
    const selectionChanged = () => { if (blocked()) cancel(); };
    if (pointer.current) {
      const { x, y } = pointer.current;
      const target = document.elementFromPoint(x, y);
      if (root.contains(target)) showCursor(x, target);
    }
    root.addEventListener('pointerover', hover);
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', hover);
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('click', click);
    root.addEventListener('dblclick', cancel);
    root.addEventListener('scroll', cancel, true);
    document.addEventListener('selectionchange', selectionChanged);
    return () => {
      cancel();
      root.removeEventListener('pointerover', hover);
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', hover);
      root.removeEventListener('pointercancel', cancel);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('click', click);
      root.removeEventListener('dblclick', cancel);
      root.removeEventListener('scroll', cancel, true);
      document.removeEventListener('selectionchange', selectionChanged);
    };
  }, [ref, enabled, page, totalPages]);
}
