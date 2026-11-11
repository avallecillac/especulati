import { posterUrl } from '../catalog/tmdb.ts';
import { posterGet, posterStore } from './dbClient.ts';

/** Object URLs by title id. A miss is not cached, so the next render tries again (the failed set stops hammering). */
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
/** Paths that failed to download this session; retried after the device comes back online. */
const failed = new Set<string>();

window.addEventListener('online', () => failed.clear());

async function download(path: string): Promise<Blob | null> {
  try {
    const res = await fetch(posterUrl(path), { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000) });
    if (!res.ok || !(res.headers.get('content-type') ?? '').toLowerCase().startsWith('image/')) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function resolve(titleId: string, path: string | null): Promise<string | null> {
  const have = await posterGet(titleId);
  if (have.ok && have.value) return URL.createObjectURL(have.value);
  // Not cached yet (added here, or synced from the partner): fetch it once, when there is an address and a connection.
  if (!path || !navigator.onLine || failed.has(path)) return null;
  const blob = await download(path);
  if (!blob) {
    failed.add(path);
    return null;
  }
  const stored = await posterStore(titleId, blob);
  if (!stored.ok || !stored.value) {
    failed.add(path);
    return null;
  }
  const again = await posterGet(titleId);
  return again.ok && again.value ? URL.createObjectURL(again.value) : null;
}

/** The cached poster for a title as an object URL, fetching it once from TMDB when missing; null shows the placeholder. */
export function posterObjectUrl(titleId: string, path: string | null): Promise<string | null> {
  const hit = cache.get(titleId);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(titleId);
  if (!p) {
    p = resolve(titleId, path).then((url) => {
      inflight.delete(titleId);
      const existing = cache.get(titleId);
      if (existing) {
        if (url) URL.revokeObjectURL(url);
        return existing;
      }
      if (url) cache.set(titleId, url);
      return url;
    });
    inflight.set(titleId, p);
  }
  return p;
}
