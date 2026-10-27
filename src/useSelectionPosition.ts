import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { SelectionData } from './types';

export function useSelectionPosition(root: RefObject<HTMLDivElement | null>, selection: SelectionData | null) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!selection) { setPosition(null); return; }
    let frame = 0;
    const update = () => {
      const sel = window.getSelection(), bar = toolbar.current, reader = root.current;
      if (!bar || !reader || !sel?.rangeCount || sel.isCollapsed || sel.toString().trim() !== selection.quote || !reader.contains(sel.anchorNode) || !reader.contains(sel.focusNode)) {
        setPosition(null); return;
      }
      const viewport = window.visualViewport, bounds = reader.getBoundingClientRect();
      const left = Math.max(bounds.left, viewport?.offsetLeft || 0) + 8;
      const right = Math.min(bounds.right, (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth)) - 8;
      const top = Math.max(bounds.top, viewport?.offsetTop || 0) + 8;
      const bottom = Math.min(bounds.bottom, (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight)) - 8;
      const range = sel.getRangeAt(0);
      const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0 && r.bottom > top && r.top < bottom && r.right > left && r.left < right);
      if (!rects.length || right <= left || bottom <= top) { setPosition(null); return; }
      // Follow the moving end of the selection, including backwards selection.
      const backwards = sel.focusNode === range.startContainer && sel.focusOffset === range.startOffset;
      const anchor = backwards ? rects[0] : rects[rects.length - 1];
      bar.style.maxWidth = `${right - left}px`;
      const size = bar.getBoundingClientRect();
      const below = anchor.bottom + 10;
      const y = below + size.height <= bottom ? below : anchor.top - size.height - 10;
      setPosition({
        left: Math.max(left, Math.min((Math.max(left, anchor.left) + Math.min(right, anchor.right) - size.width) / 2, right - size.width)),
        top: Math.max(top, Math.min(y, bottom - size.height)),
      });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    const observer = new ResizeObserver(schedule);
    if (root.current) observer.observe(root.current);
    if (toolbar.current) observer.observe(toolbar.current);
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [root, selection]);
  return { toolbar, style: position ? { ...position, visibility: 'visible' as const } : { visibility: 'hidden' as const } };
}
