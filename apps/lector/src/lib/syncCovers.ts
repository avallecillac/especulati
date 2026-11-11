import { fetchCover } from '../catalog/cover.ts';
import { query, storeCover } from './dbClient.ts';

const CONCURRENCY = 2;
let running = false;

/**
 * Download and cache covers for books that arrived by sync with a cover address (FR-016). Same
 * download and worker `storeCover` as for books added on this device. Does nothing offline;
 * a failed download just stays missing until the next changed run.
 */
export async function fillMissingCovers(): Promise<void> {
  if (running || !navigator.onLine) return;
  running = true;
  try {
    const r = await query({ name: 'missingCovers' });
    if (!r.ok) return;
    const queue = [...r.value];
    const worker = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        if (!navigator.onLine) return;
        const blob = await fetchCover(m.coverUrl, { fetch: (u, i) => fetch(u, i) });
        if (blob) await storeCover(m.itemId, blob);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  } catch {
    // Covers are optional.
  } finally {
    running = false;
  }
}
