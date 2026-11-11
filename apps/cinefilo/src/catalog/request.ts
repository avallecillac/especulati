import type { Fetch, TmdbFailure } from './types.ts';

export type Fetched = { kind: 'ok'; json: unknown } | Exclude<TmdbFailure, { kind: 'no-key' | 'bad-response' }>;

export const TMDB_API = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w342';

/** A v4 read-access token is a JWT (three dot-separated parts, starts "eyJ"); a v3 key is 32 hex characters. */
export function isV4Token(key: string): boolean {
  return key.startsWith('eyJ') && key.split('.').length === 3;
}

/**
 * A GET against api.themoviedb.org with one 8 s deadline (raced, so a fetch that ignores the signal still times
 * out). The key goes in a header (v4) or the `api_key` parameter (v3) and appears in no result: failures are
 * plain `{ kind }` values, nothing is thrown, nothing logged.
 */
export async function tmdbGet(path: string, params: Record<string, string>, key: string, deps: { fetch: Fetch; timeoutMs?: number }): Promise<Fetched> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 8000);
  const deadline = new Promise<Fetched>((resolve) => signal.addEventListener('abort', () => resolve({ kind: 'timeout' }), { once: true }));
  const q = new URLSearchParams(params);
  const v4 = isV4Token(key);
  if (!v4) q.set('api_key', key);
  const url = `${TMDB_API}/${path}?${q.toString()}`;
  const request = (async (): Promise<Fetched> => {
    try {
      const res = await deps.fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal,
        ...(v4 ? { headers: { Authorization: `Bearer ${key}`, accept: 'application/json' } } : {}),
      });
      if (res.ok) return { kind: 'ok', json: await res.json() };
      if (res.status === 401) return { kind: 'unauthorized' };
      if (res.status === 404) return { kind: 'not-found' };
      if (res.status === 429) return { kind: 'rate-limited' };
      return { kind: 'http', status: res.status };
    } catch {
      return signal.aborted ? { kind: 'timeout' } : { kind: 'network' };
    }
  })();
  return Promise.race([request, deadline]);
}
