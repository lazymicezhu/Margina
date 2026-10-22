export type PageSwipe = { x: number; y: number; started: number; width: number; locked: boolean };

export function startPageSwipe(x: number, y: number, time: number, left: number, width: number): PageSwipe | null {
  // Leave the screen edges to browser navigation.
  if (x - left < 24 || left + width - x < 24) return null;
  return { x, y, started: time, width, locked: false };
}

export function movePageSwipe(swipe: PageSwipe, x: number, y: number, time: number): boolean {
  const dx = Math.abs(x - swipe.x), dy = Math.abs(y - swipe.y);
  // Once a gesture becomes a scroll or long press, it cannot become a page turn.
  if (time - swipe.started > 600 || (dy > 12 && dx < dy * 1.5)) return false;
  if (dx > 12 && dx > dy * 1.5) swipe.locked = true;
  return true;
}

export function finishPageSwipe(swipe: PageSwipe, x: number, y: number, time: number): -1 | 0 | 1 {
  if (!movePageSwipe(swipe, x, y, time)) return 0;
  const dx = x - swipe.x, dy = Math.abs(y - swipe.y);
  const minimum = Math.max(48, Math.min(96, swipe.width * 0.18));
  if (Math.abs(dx) < minimum || Math.abs(dx) < dy * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
