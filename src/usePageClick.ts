import { useEffect, useRef, type RefObject } from 'react';

export function usePageClick(ref: RefObject<HTMLDivElement | null>, enabled: boolean, page: number, turn: (direction: number) => void) {
  const turnRef = useRef(turn); turnRef.current = turn;
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
    const cancel = () => { press = null; clearTimeout(timer); };
    const down = (event: PointerEvent) => {
      cancel();
      if (event.pointerType !== 'mouse' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || blocked() || excluded(event.target)) return;
      press = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    };
    const move = (event: PointerEvent) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) cancel();
    };
    const click = (event: MouseEvent) => {
      const start = press; press = null;
      if (!start || event.detail !== 1 || blocked() || excluded(event.target) || event.timeStamp - start.time > 500 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const box = root.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX >= box.left + root.clientWidth) return;
      const direction = event.clientX < box.left + root.clientWidth / 2 ? -1 : 1;
      // Leave time for a second click to select a word before changing pages.
      timer = setTimeout(() => { if (!blocked()) turnRef.current(direction); }, 300);
    };
    const selectionChanged = () => { if (blocked()) cancel(); };
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('pointerleave', cancel);
    root.addEventListener('click', click);
    root.addEventListener('dblclick', cancel);
    root.addEventListener('scroll', cancel, true);
    document.addEventListener('selectionchange', selectionChanged);
    return () => {
      cancel();
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointercancel', cancel);
      root.removeEventListener('pointerleave', cancel);
      root.removeEventListener('click', click);
      root.removeEventListener('dblclick', cancel);
      root.removeEventListener('scroll', cancel, true);
      document.removeEventListener('selectionchange', selectionChanged);
    };
  }, [ref, enabled, page]);
}
