import type { Fetch } from './types.ts';

export const toCoverUrl = (id: number): string => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;

const MIN_BYTES = 1024;

/** Downloads a cover. Null on any failure, non-image, or placeholder-sized body. */
export async function fetchCover(url: string, deps: { fetch: Fetch; timeoutMs?: number }): Promise<Blob | null> {
  try {
    const res = await deps.fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').toLowerCase().startsWith('image/')) return null;
    const blob = await res.blob();
    return blob.size >= MIN_BYTES ? blob : null;
  } catch {
    return null;
  }
}
