import type { Paper } from './cloud-types';

export type MetadataStatus = 'loading' | 'ready' | 'unavailable' | 'error';
export type MetadataBatch = { papers: Paper[]; unavailable: string[]; locked: string[] };
export const metadataKey = (owner: string) => `paper-metadata-v1:${owner}`;

// A slow batch must not block the rest of a large shelf. Never download files here.
export async function resolveMetadata(
  ids: string[],
  request: (ids: string[]) => Promise<MetadataBatch>,
  receive: (ids: string[], result?: MetadataBatch) => void,
  signal: AbortSignal,
) {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 40) batches.push(ids.slice(i, i + 40));
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (!signal.aborted && next < batches.length) {
      const batch = batches[next++];
      try {
        const result = await request(batch);
        if (!signal.aborted) receive(batch, result);
      } catch {
        if (!signal.aborted) receive(batch);
      }
    }
  }));
}

// Stored metadata is only a display cache. File reads still enforce server access.
export function cachedMetadata(value: unknown, ids: string[]): Record<string, Paper> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = value as Record<string, Paper>;
  return Object.fromEntries(ids.filter(id => entries[id]?.id === id && typeof entries[id].title === 'string').map(id => [id, entries[id]]));
}
