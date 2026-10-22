import type { AccountState, LocalRecord, ReadingData, RemoteRecord } from './cloud-types';
import { emptyReading } from './cloud-types';
import { setting, updateSetting } from './storage';
import { api, ApiError, jsonOptions } from './cloud-api';
import { equalReading, mergeReading } from './sync-merge';

const key = (user: string) => `account-v1:${user}`;
const emptyState = (): AccountState => ({ cursor: 0, records: {}, lastSynced: 0 });
export const readAccount = async (user: string): Promise<AccountState> => (await setting(key(user)) as AccountState) || emptyState();
const change = (user: string, fn: (state: AccountState) => AccountState) => updateSetting(key(user), emptyState(), fn);
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('margina-account-updates') : null;
function announce(user: string, edited: boolean) {
  window.dispatchEvent(new CustomEvent('margina-account', { detail: { user, edited } }));
  channel?.postMessage({ user, edited });
}
if (channel) channel.onmessage = event => window.dispatchEvent(new CustomEvent('margina-account', { detail: event.data }));

export async function editReading(user: string, id: string, patch: Partial<ReadingData>) {
  await change(user, state => {
    const old = state.records[id] || { version: 0, base: emptyReading(), data: emptyReading(), dirty: false };
    const data = { ...old.data, ...patch };
    return { ...state, records: { ...state.records, [id]: { ...old, data, dirty: !equalReading(data, old.base) } } };
  });
  announce(user, true);
}
function accept(old: LocalRecord | undefined, record: RemoteRecord): LocalRecord {
  if (old && record.version < old.version) return old;
  const data = old?.dirty ? mergeReading(old.base, old.data, record.data) : record.data;
  return { version: record.version, base: record.data, data, dirty: !equalReading(data, record.data) };
}
const running = new Map<string, Promise<void>>();
export function syncAccount(user: string) {
  if (running.has(user)) return running.get(user)!;
  const work = async () => {
    let more = true;
    while (more) {
      const state = await readAccount(user);
      const result = await api<{ records: RemoteRecord[]; cursor: number; more: boolean }>(`/api/private/records?after=${state.cursor}`, { headers: { 'X-Margina-User': user } });
      await change(user, latest => {
        const records = { ...latest.records };
        for (const record of result.records) records[record.bookId] = accept(records[record.bookId], record);
        return { ...latest, records, cursor: Math.max(latest.cursor, result.cursor) };
      });
      more = result.more;
    }
    const ids = Object.keys((await readAccount(user)).records);
    for (const id of ids) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const sent = (await readAccount(user)).records[id];
        if (!sent?.dirty) break;
        try {
          const options = jsonOptions('PUT', { version: sent.version, data: sent.data });
          const result = await api<{ record: RemoteRecord }>(`/api/private/records/${id}`, { ...options, headers: { ...options.headers, 'X-Margina-User': user } });
          await change(user, latest => {
            const current = latest.records[id];
            // Preserve edits committed while this request was in flight.
            const data = mergeReading(sent.data, current.data, result.record.data);
            return { ...latest, records: { ...latest.records, [id]: { version: result.record.version, base: result.record.data, data, dirty: !equalReading(data, result.record.data) } } };
          });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          const record = (error.body as { record: RemoteRecord }).record;
          await change(user, latest => ({ ...latest, records: { ...latest.records, [id]: accept(latest.records[id], record) } }));
          if (attempt === 3) throw new Error('其他设备正在编辑，修改已保存在本机，请稍后重试同步。');
        }
      }
    }
    const finalState = await readAccount(user);
    if (Object.values(finalState.records).some(record => record.dirty)) throw new Error('仍有本机修改等待同步，请稍后重试。');
    await change(user, state => ({ ...state, lastSynced: Date.now() }));
  };
  const promise = (async () => { if (navigator.locks) await navigator.locks.request(`margina-sync:${user}`, work); else await work(); })()
    .finally(() => { running.delete(user); announce(user, false); });
  running.set(user, promise);
  return promise;
}
