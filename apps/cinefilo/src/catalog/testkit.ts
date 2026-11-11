// Test helpers: a fake `fetch` that serves the recorded fixtures by URL.
const raw = import.meta.glob('./fixtures/*.json', { eager: true, query: '?raw', import: 'default' });

export function fixture(name: string): string {
  const text = raw[`./fixtures/${name}.json`];
  if (text === undefined) throw new Error(`no fixture ${name}`);
  return text;
}

export type Route = { status?: number; body?: string } | 'hang' | 'throw';

export interface FakeFetch {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  calls: { url: string; init: RequestInit | undefined }[];
}

/** Routes by URL path prefix match on `api.themoviedb.org/3/<path>`; unrouted paths answer 404. */
export function fakeFetch(routes: Record<string, Route>): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const impl = (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, init });
    const path = new URL(input).pathname.replace(/^\/3\//, '');
    const route = routes[path];
    if (route === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
    if (route === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    const r = route ?? { status: 404, body: '{}' };
    return Promise.resolve(new Response(r.body ?? '{}', { status: r.status ?? 200, headers: { 'content-type': 'application/json' } }));
  };
  return { fetch: impl, calls };
}
