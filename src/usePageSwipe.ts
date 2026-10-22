import { useEffect, useRef, type RefObject } from 'react';
import { finishPageSwipe, movePageSwipe, startPageSwipe, type PageSwipe } from './page-swipe';

export function usePageSwipe(ref: RefObject<HTMLDivElement | null>, enabled: boolean, page: number, turn: (direction: number) => void) {
  const turnRef = useRef(turn); turnRef.current = turn;
  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let gesture: PageSwipe | null = null;
    let finger = -1;
    const blocked = () => (window.visualViewport?.scale || 1) > 1.05 || !!window.getSelection()?.toString().trim();
    const cancel = () => { gesture = null; finger = -1; };
    const start = (event: TouchEvent) => {
      cancel();
      if (event.touches.length !== 1 || blocked()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"]')) return;
      const overflow = target?.closest('.pdf-overflow');
      if (overflow && overflow.scrollWidth > overflow.clientWidth + 2) return;
      const touch = event.touches[0], box = root.getBoundingClientRect();
      gesture = startPageSwipe(touch.clientX, touch.clientY, event.timeStamp, box.left, box.width);
      finger = touch.identifier;
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = Array.from(event.touches).find(t => t.identifier === finger);
      if (event.touches.length !== 1 || !touch || blocked() || !movePageSwipe(gesture, touch.clientX, touch.clientY, event.timeStamp)) { cancel(); return; }
      // Intercept only a deliberate horizontal gesture; vertical scroll and
      // pinch zoom retain their native behavior. Never disable text selection.
      if (gesture.locked) {
        if (!event.cancelable) { cancel(); return; }
        event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      const current = gesture;
      const touch = Array.from(event.changedTouches).find(t => t.identifier === finger);
      cancel();
      if (!current || !touch || event.touches.length || blocked()) return;
      const direction = finishPageSwipe(current, touch.clientX, touch.clientY, event.timeStamp);
      if (direction) turnRef.current(direction);
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      cancel();
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', cancel);
    };
  }, [ref, enabled, page]);
}
