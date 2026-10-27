// Keep documents, account data and list snapshots in memory, never in history.state.
export type ReaderEntry<T> = { kind: 'list' | 'reader'; data?: T; ticket: number };
type Host = Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>;
const key = 'marginaReader';
export function createReaderNavigation<T>(host: Host, changed: (entry: ReaderEntry<T>) => void) {
  const session = `${Date.now()}-${Math.random()}`;
  const entries = new Map<number, ReaderEntry<T>>();
  let sequence = 0;
  let leaving = false;
  let current: ReaderEntry<T>;
  const state = (ticket: number) => ({ ...host.history.state, [key]: { session, ticket } });
  const replaceList = () => {
    current = { kind: 'list', ticket: ++sequence };
    entries.set(current.ticket, current);
    host.history.replaceState(state(current.ticket), '');
  };
  replaceList();
  const pop = () => {
    leaving = false;
    const marker = host.history.state?.[key];
    const found = marker?.session === session ? entries.get(marker.ticket) : undefined;
    if (found) current = found;
    else replaceList(); // Reloaded/expired entries cannot reopen a prior account's book.
    changed(current);
  };
  host.addEventListener('popstate', pop);
  return {
    enter(data: T) {
      leaving = false;
      if (current.kind !== 'list') replaceList();
      for (const ticket of entries.keys()) if (ticket > current.ticket) entries.delete(ticket);
      current.data = data;
      // Another app action may have replaced history.state in the meantime.
      host.history.replaceState(state(current.ticket), '');
      current = { kind: 'reader', data, ticket: ++sequence };
      entries.set(current.ticket, current);
      host.history.pushState(state(current.ticket), '');
      return current.ticket;
    },
    isCurrent(ticket: number) { return current.kind === 'reader' && current.ticket === ticket; },
    back() { if (current.kind === 'reader' && !leaving) { leaving = true; host.history.back(); } },
    reset() { leaving = false; entries.clear(); replaceList(); },
    dispose() { host.removeEventListener('popstate', pop); entries.clear(); },
  };
}
