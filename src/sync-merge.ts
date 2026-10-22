import type { Annotation } from './types';
import type { ReadingData } from './cloud-types';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function conflictId(note: Annotation) {
  // A deterministic suffix keeps retries from creating more conflict copies.
  let hash = 14695981039346656037n;
  for (const char of JSON.stringify(note)) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n);
  return `${note.id.slice(0, 120)}:conflict:${hash.toString(16)}`;
}
export function mergeReading(base: ReadingData, local: ReadingData, remote: ReadingData): ReadingData {
  const choose = <T,>(b: T, l: T, r: T) => same(l, b) ? r : same(r, b) || same(l, r) ? l : r;
  const baseNotes = new Map(base.annotations.map(n => [n.id, n]));
  const localNotes = new Map(local.annotations.map(n => [n.id, n]));
  const remoteNotes = new Map(remote.annotations.map(n => [n.id, n]));
  const notes = new Map<string, Annotation>();
  for (const id of new Set([...baseNotes.keys(), ...localNotes.keys(), ...remoteNotes.keys()])) {
    const b = baseNotes.get(id), l = localNotes.get(id), r = remoteNotes.get(id);
    if (same(l, b)) { if (r) notes.set(id, r); }
    else if (same(r, b) || same(l, r)) { if (l) notes.set(id, l); }
    else {
      // Concurrent edit/edit keeps both; edit/delete keeps the changed note.
      if (r) notes.set(id, r);
      if (l) {
        const copy = r ? { ...l, id: conflictId(l), text: `【并发修改副本】\n${l.text}` } : l;
        notes.set(copy.id, copy);
      }
    }
  }
  const bookmarks = [...new Set([...base.bookmarks, ...local.bookmarks, ...remote.bookmarks])]
    .filter(p => choose(base.bookmarks.includes(p), local.bookmarks.includes(p), remote.bookmarks.includes(p))).sort((a, b) => a - b);
  const progress = same([local.page, local.opened], [base.page, base.opened]) ? remote
    : same([remote.page, remote.opened], [base.page, base.opened]) ? local : local.opened > remote.opened ? local : remote;
  return {
    shelf: choose(base.shelf, local.shelf, remote.shelf), starred: choose(base.starred, local.starred, remote.starred),
    page: progress.page, opened: progress.opened, bookmarks, annotations: [...notes.values()],
  };
}
export const equalReading = same;
