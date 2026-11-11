// Cinéfilo peers for the sync, reconcile, redaction and convergence suites: a CinefiloDb plus the shared sync
// engine with cinefiloSyncApp, over the shared fake relay.
import { createSyncEngine, type SyncEngine } from '@especulati/sync';
import { fakeRelay, prng, randomBytes, type FakeRelay } from '../../sync/test/relayHarness.ts';
import { cinefiloSyncApp, reconcileAll } from '../src/index.ts';
import { hashIdAsync, openTestDb, type TestDb } from './helpers.ts';

export { fakeRelay, prng };
export type { FakeRelay };

export interface Peer extends TestDb {
  n: number;
  engine: SyncEngine;
  online: boolean;
  /** The shell's follow-up after a sync or a local add/link. */
  reconcile(): Promise<number>;
  close(): void;
}

export function makePeer(n: number, relay: FakeRelay, memberId: string | null, rng: () => number = prng(n), start = Date.UTC(2026, 8, 27, 12, 0, 0)): Peer {
  const t = openTestDb(n, memberId, start);
  const baseTick = (ms?: number) => t.tick(ms);
  const peer: Peer = {
    ...t,
    n,
    online: true,
    engine: undefined as never,
    tick(ms = 1000) {
      baseTick(ms);
    },
    reconcile: () => reconcileAll(t.db, () => t.env, hashIdAsync),
    close: () => t.raw.close(),
  };
  peer.engine = createSyncEngine({
    store: t.db.syncStore, app: cinefiloSyncApp, fetch: relay.fetch, now: () => t.env.wallMs(), random: randomBytes(rng), online: () => peer.online,
  });
  return peer;
}

/** Every peer runs until two whole rounds bring and send nothing; reconcile runs after each run, as in the worker. */
export async function untilQuiet(peers: Peer[], reconcile = true): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < 16 && quiet < 2; round++) {
    let moved = 0;
    for (const p of peers) {
      p.tick(1000);
      const r = await p.engine.run('manual');
      if (r.problem) throw new Error(`run problem: ${r.problem}`);
      moved += r.pulled + r.pushed;
      if (reconcile) moved += await p.reconcile();
    }
    quiet = moved === 0 ? quiet + 1 : 0;
  }
  if (quiet < 2) throw new Error('did not go quiet in 16 rounds');
}
