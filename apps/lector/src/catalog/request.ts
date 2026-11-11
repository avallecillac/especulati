import type { Fetch } from './types.ts';

export type Fetched =
  | { kind: 'ok'; json: unknown }
  | { kind: 'fail'; reason: 'network' | 'http'; status?: number }
  | { kind: 'timeout' };

/**
 * A GET helper with the catalog privacy options and one shared deadline for every request
 * it makes. Racing the deadline too means a fetch that ignores the signal still times out.
 */
export function createGetter(deps: { fetch: Fetch; timeoutMs?: number }): (url: string, opts?: { googleKey?: string | null }) => Promise<Fetched> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 8000);
  const deadline = new Promise<Fetched>((resolve) => {
    signal.addEventListener('abort', () => resolve({ kind: 'timeout' }), { once: true });
  });

  return (url, opts) => {
    // Only Google requests get a key (contract: Google Books key). Null or empty means byte-identical to no key.
    const key = opts?.googleKey ? opts.googleKey : null;
    const target = key === null ? url : `${url}&key=${encodeURIComponent(key)}`;
    const referrerPolicy = key === null ? 'no-referrer' : 'strict-origin';
    const request = (async (): Promise<Fetched> => {
      try {
        const res = await deps.fetch(target, { credentials: 'omit', referrerPolicy, cache: 'no-store', signal });
        if (!res.ok) return { kind: 'fail', reason: 'http', status: res.status };
        return { kind: 'ok', json: await res.json() };
      } catch {
        return signal.aborted ? { kind: 'timeout' } : { kind: 'fail', reason: 'network' };
      }
    })();
    return Promise.race([request, deadline]);
  };
}
