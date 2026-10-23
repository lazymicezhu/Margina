import { useEffect, useRef, useState } from 'react';
import { api, jsonOptions } from './cloud-api';
import { invalidateShelf, resetShelfOwner, setLockedBooks, setShelfToken } from './shelf-lock';
import { resetReadingCursor } from './sync';
export type ShelfFolder = { id: string; name: string; protected: boolean; locked: boolean; count: number };
export type ShelfItem = { bookId: string; folderId: string | null; remark: string };
type Snapshot = { folders: ShelfFolder[]; items: ShelfItem[] };
export function useShelf(user: string | undefined) {
  const [data, setData] = useState<Snapshot>({ folders: [], items: [] });
  const [ready, setReady] = useState(false);
  const [dataOwner, setDataOwner] = useState<string>();
  const [error, setError] = useState('');
  const owner = useRef(user); owner.current = user;
  const serial = useRef(0);
  const previouslyBlocked = useRef<Set<string> | null>(null);
  const [expires, setExpires] = useState(0);
  const activeOwner = useRef<string | undefined>(undefined);
  // Reset access before any account-specific child renders.
  if (activeOwner.current !== user) { activeOwner.current = user; resetShelfOwner(user || ''); previouslyBlocked.current = null; }
  async function refresh() {
    const id = user, n = ++serial.current;
    if (!id) return;
    try {
      const next = await api<Snapshot>('/api/private/shelf', { headers: { 'X-Margina-User': id } });
      if (owner.current !== id || n !== serial.current) return;
      const lockedFolders = new Set(next.folders.filter(f => f.locked).map(f => f.id));
      const blocked = new Set(next.items.filter(i => i.folderId && lockedFolders.has(i.folderId)).map(i => i.bookId));
      if (!previouslyBlocked.current || [...previouslyBlocked.current].some(id => !blocked.has(id))) await resetReadingCursor(id);
      if (owner.current !== id || n !== serial.current) return;
      previouslyBlocked.current = blocked;
      setLockedBooks([...blocked]);
      setData(next); setDataOwner(id); setReady(true); setError('');
      return next;
    } catch (e) {
      if (owner.current === id && n === serial.current) { invalidateShelf(); setReady(false); setError(e instanceof Error ? e.message : '文件夹加载失败'); }
      throw e;
    }
  }
  useEffect(() => {
    setData({ folders: [], items: [] }); setReady(false); setError('');
    if (user) void refresh().catch(() => {});
    return () => { serial.current++; };
  }, [user]);
  useEffect(() => {
    if (!expires || !user) return;
    const timer = setTimeout(() => { setShelfToken(''); invalidateShelf(); setReady(false); void refresh().catch(() => {}); }, Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [expires, user]);
  async function mutate(path: string, method: string, body?: unknown) {
    const id = user; if (!id) throw new Error('请先登录');
    const options = body === undefined ? { method } : jsonOptions(method, body);
    const result = await api<{ token?: string; id?: string }>(`/api/private/shelf${path}`, { ...options, headers: { ...options.headers, 'X-Margina-User': id } });
    if (owner.current !== id) return;
    if (result.token) { setShelfToken(result.token); setExpires(Date.now() + 8 * 3600000); }
    if (path.endsWith('/lock')) setShelfToken('');
    await refresh();
    return result;
  }
  const current = dataOwner === user ? data : { folders: [], items: [] };
  const available = ready && dataOwner === user;
  const item = (id: string) => current.items.find(i => i.bookId === id);
  const locked = (id: string) => !available || current.folders.some(f => f.locked && f.id === item(id)?.folderId);
  return { ...current, ready: available, error, refresh, mutate, item, locked };
}
