import { useEffect, useRef, useState } from 'react';
import { api } from './cloud-api';
import type { Paper } from './cloud-types';
import { setting } from './storage';
import { cachedMetadata, metadataKey, resolveMetadata, type MetadataBatch, type MetadataStatus } from './paper-metadata';

type Snapshot = { owner?: string; papers: Record<string, Paper>; status: Record<string, MetadataStatus> };
export function usePaperMetadata(owner: string | undefined, ids: string[]) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ papers: {}, status: {} });
  const [revision, setRevision] = useState(0);
  const memory = useRef<{ owner?: string; papers: Record<string, Paper>; checked: Set<string>; revision: number }>({ papers: {}, checked: new Set(), revision: 0 });
  // Reading progress/ratings change frequently; only membership or access changes
  // should restart metadata requests, not each incoming reading-record update.
  const key = JSON.stringify([...new Set(ids)].sort());
  useEffect(() => {
    if (!owner) { memory.current = { papers: {}, checked: new Set(), revision }; return; }
    if (memory.current.owner !== owner) memory.current = { owner, papers: {}, checked: new Set(), revision };
    const cache = memory.current;
    if (cache.revision !== revision) { cache.checked.clear(); cache.revision = revision; }
    const wanted: string[] = JSON.parse(key);
    const controller = new AbortController();
    const status: Record<string, MetadataStatus> = {};
    for (const id of wanted) status[id] = cache.checked.has(id) ? (cache.papers[id] ? 'ready' : 'unavailable') : 'loading';
    const publish = () => setSnapshot({ owner, papers: cachedMetadata(cache.papers, wanted), status: { ...status } });
    publish();
    if (!wanted.length) return () => controller.abort();
    void (async () => {
      const saved = await setting(metadataKey(owner)).catch(() => undefined);
      if (controller.signal.aborted) return;
      for (const [id, paper] of Object.entries(cachedMetadata(saved, wanted))) {
        if (!cache.checked.has(id) && !cache.papers[id]) cache.papers[id] = paper;
      }
      publish();
      await resolveMetadata(wanted.filter(id => !cache.checked.has(id)), async batch => {
        const requestController = new AbortController();
        const cancel = () => requestController.abort();
        controller.signal.addEventListener('abort', cancel, { once: true });
        const timeout = setTimeout(cancel, 15000);
        try {
          return await api<MetadataBatch>(`/api/account/metadata?ids=${batch.join(',')}`, {
            headers: { 'X-Margina-User': owner }, signal: requestController.signal,
          });
        } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancel); }
      }, (batch, result) => {
        for (const id of batch) {
          const paper = result?.papers.find(p => p.id === id);
          if (paper) { cache.papers[id] = paper; cache.checked.add(id); status[id] = 'ready'; }
          else if (result?.unavailable.includes(id)) { delete cache.papers[id]; cache.checked.add(id); status[id] = 'unavailable'; }
          else { status[id] = 'error'; if (result?.locked.includes(id)) delete cache.papers[id]; }
        }
        publish();
      }, controller.signal);
      if (!controller.signal.aborted) await setting(metadataKey(owner), cachedMetadata(cache.papers, wanted)).catch(() => {});
    })();
    return () => controller.abort();
  }, [owner, key, revision]);
  const data = snapshot.owner === owner ? snapshot : { papers: {}, status: {} };
  return { ...data, retry: () => setRevision(value => value + 1) };
}
