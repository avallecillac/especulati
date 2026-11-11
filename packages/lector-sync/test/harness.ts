// Lector peers for the convergence, capture-peer and privacy suites: a LectorDb plus the sync engine
// with lectorSyncApp, over the shared fake relay.
import type { DeviceId, Instant } from '@especulati/lector-core';
import { LectorDb, type DispatchEnv } from '../../lector-db/src/index.ts';
import { emptyDb, uuid } from '../../lector-db/test/helpers.ts';
import { createSyncEngine, type SyncEngine } from '@especulati/sync';
import { fakeRelay, prng, randomBytes, type FakeRelay } from '../../sync/test/relayHarness.ts';
import { lectorSyncApp } from '../src/index.ts';

// The fake relay lives with the generic sync tests; re-exported so lector suites import one harness.
export { fakeRelay, prng, randomBytes, uuid };
export type { FakeRelay, RelayCounts } from '../../sync/test/relayHarness.ts';

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
  peer.engine = createSyncEngine({ store: db.syncStore, app: lectorSyncApp, fetch: relay.fetch, now: () => wall, random: randomBytes(rng), online: () => peer.online });
  return peer;
}
