// Shared by engine.test.ts and convergence.test.ts. The fake relay is the real handler over the
// SQLite test store, wrapped as `fetch`. Test files only: production sync code never imports apps/*.
import type { DeviceId, Instant } from '@especulati/lector-core';
import { LectorDb, type DispatchEnv } from '../../lector-db/src/index.ts';
import { emptyDb, uuid } from '../../lector-db/test/helpers.ts';
import { handle } from '../../../apps/relay/src/handler.ts';
import { sqliteStore, type TestStore } from '../../../apps/relay/test/sqliteStore.ts';
import { createSyncEngine, type SyncEngine } from '../src/engine.ts';

export { uuid };

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

export interface Peer {
  n: number;
  db: LectorDb;
  engine: SyncEngine;
  device: DeviceId;
  online: boolean;
  /** Advance this peer's clock (ms). */
  tick(ms?: number): void;
  env: DispatchEnv;
  /** Set the wall clock backwards or forwards absolutely. */
  wall(): number;
  close(): void;
}

export function makePeer(n: number, relay: FakeRelay, rng: () => number = prng(n), start = Date.UTC(2026, 8, 27, 12, 0, 0)): Peer {
  const raw = emptyDb();
  const db = new LectorDb(raw);
  db.migrate();
  const device = db.ensureDeviceId(uuid(0xd000 + n));
  let wall = start;
  let opN = 0;
  const env: DispatchEnv = {
    now: new Date(wall).toISOString() as Instant,
    wallMs: () => wall,
    newOpId: () => uuid(n * 0x1000000 + ++opN),
  };
  const peer: Peer = {
    n,
    db,
    device,
    online: true,
    env,
    wall: () => wall,
    tick(ms = 1000) {
      wall += ms;
      env.now = new Date(wall).toISOString() as Instant;
    },
    engine: undefined as never,
    close: () => raw.close(),
  };
  peer.engine = createSyncEngine({ db, fetch: relay.fetch, now: () => wall, random: randomBytes(rng), online: () => peer.online });
  return peer;
}
