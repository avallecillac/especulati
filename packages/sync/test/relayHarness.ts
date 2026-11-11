// Fake relay for the sync tests: the real relay handler over the SQLite test store, wrapped as
// `fetch`. Shared by the generic engine tests here and by lector-sync's harness. Test files only:
// production sync code never imports apps/*.
import { handle } from '../../../apps/relay/src/handler.ts';
import { sqliteStore, type TestStore } from '../../../apps/relay/test/sqliteStore.ts';

/** Small seeded PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomBytes = (rng: () => number) => (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rng() * 256));

export interface RelayCounts {
  requests: number;
  reads: number;
  writes: number;
}

export interface FakeRelay {
  fetch: typeof fetch;
  store: TestStore;
  /** Every request seen, in order. */
  log: { method: string; path: string }[];
  counts: RelayCounts;
  /** Runs before the handler; return a Response to short-circuit, or throw to simulate a network error. */
  before?: ((req: { method: string; path: string; body: string | null }) => Promise<Response | void> | Response | void) | undefined;
  /** Runs after the handler stored its result; throwing here loses the response (a crash). */
  after?: ((req: { method: string; path: string }) => void) | undefined;
}

/** Wrap the store so D1 row reads/writes are counted the way d1Store issues them (relay-api.md). */
function countingStore(inner: TestStore, counts: RelayCounts): TestStore {
  return {
    ...inner,
    async getSpace(id) {
      counts.reads++;
      return inner.getSpace(id);
    },
    async createSpace(id, h, now) {
      const r = await inner.createSpace(id, h, now);
      if (r) counts.writes++;
      return r;
    },
    async deleteSpace(id) {
      counts.writes++;
      return inner.deleteSpace(id);
    },
    async appendBatch(id, b, now) {
      const r = await inner.appendBatch(id, b, now);
      if (!r.duplicate) counts.writes++;
      counts.reads++;
      return r;
    },
    async listBatches(id, after, limit) {
      const rows = await inner.listBatches(id, after, limit);
      counts.reads += rows.length;
      return rows;
    },
    async hit(id, minute) {
      counts.writes++;
      counts.reads++;
      return inner.hit(id, minute);
    },
    async prune(m) {
      counts.writes++;
      return inner.prune(m);
    },
  };
}

export function fakeRelay(): FakeRelay {
  const inner = sqliteStore();
  const counts: RelayCounts = { requests: 0, reads: 0, writes: 0 };
  const store = countingStore(inner, counts);
  let relayNow = Date.UTC(2026, 8, 27, 12, 0, 0);
  const relay: FakeRelay = {
    store,
    log: [],
    counts,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'https://relay.test');
      const method = init?.method ?? 'GET';
      const path = url.pathname + url.search;
      relay.log.push({ method, path });
      counts.requests++;
      const body = typeof init?.body === 'string' ? init.body : null;
      const early = await relay.before?.({ method, path, body });
      if (early) return early;
      const req = new Request(url, { method, headers: init?.headers ?? {}, body });
      const res = await handle(req, store, () => (relayNow += 1000));
      relay.after?.({ method, path });
      return res;
    },
  };
  return relay;
}
