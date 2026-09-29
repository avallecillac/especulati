// Convergence (research R11, SC-003), the 10k-op perf case (SC-004) and the free-tier usage
// measurement (research R1, FR-023, SC-007). All randomness is a seeded PRNG in this file.
import { describe, expect, it } from 'vitest';
import { parseRemoteOp, type EventType, type OpWire } from '@readerlog/core';
import { applyChanges } from '../../db/src/index.ts';
import { fakeRelay, makePeer, prng, uuid, type FakeRelay, type Peer } from './harness.ts';

// SC-003 requires 1,000 runs: `pnpm test:convergence`. The everyday `pnpm test` runs 200.
const RUNS = Number(process.env['CONVERGENCE_RUNS'] ?? 200);
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const TYPES: EventType[] = ['started', 'progress', 'progress', 'finished', 'abandoned'];

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

let idN = 0x40000000;
const newId = () => uuid(++idN);

const ids = (p: Peer, sql: string): string[] => p.db.raw.selectValues(sql).map(String);

/** One random local write on a peer. Rejections are fine: they change nothing. */
function localWrite(rng: () => number, p: Peer): void {
  p.tick(int(rng, 1, 5000));
  const items = ids(p, 'SELECT id FROM items WHERE deleted_at IS NULL');
  const localDate = '2026-09-01';
  const kind = rng();
  if (items.length === 0 || kind < 0.25) {
    p.db.dispatch(
      { kind: 'AddBook', itemId: newId(), title: `Book ${int(rng, 0, 999)}`, totalPages: rng() < 0.5 ? int(rng, 50, 900) : null, startNow: rng() < 0.5, startEventId: newId(), localDate },
      p.env,
    );
  } else if (kind < 0.45) {
    p.db.dispatch({ kind: 'EditBook', itemId: pick(rng, items), title: `Title ${int(rng, 0, 999)}`, author: rng() < 0.5 ? `Author ${int(rng, 0, 9)}` : null }, p.env);
  } else if (kind < 0.75) {
    p.db.dispatch({ kind: 'LogEvent', itemId: pick(rng, items), eventId: newId(), type: pick(rng, TYPES), page: int(rng, 1, 60), localDate }, p.env);
  } else if (kind < 0.88) {
    const evs = p.db.raw.selectObjects('SELECT id, item_id FROM reading_events WHERE deleted_at IS NULL');
    if (evs.length > 0) {
      const e = pick(rng, evs);
      p.db.dispatch({ kind: 'RemoveEvent', itemId: e.item_id as string, eventId: e.id as string }, p.env);
    }
  } else if (kind < 0.94) {
    p.db.dispatch({ kind: 'RemoveBook', itemId: pick(rng, items) }, p.env);
  } else if (items.length >= 2) {
    // A duplicate dismissal (no command exists yet): create or tombstone one.
    const existing = ids(p, 'SELECT id FROM duplicate_dismissals');
    const changes =
      existing.length > 0 && rng() < 0.4
        ? [{ tbl: 'duplicate_dismissals' as const, rowId: pick(rng, existing), fields: { deleted_at: p.env.now } }]
        : [{ tbl: 'duplicate_dismissals' as const, rowId: newId(), fields: { item_a: items[0]!, item_b: items[1]!, created_at: p.env.now } }];
    p.db.raw.exec('BEGIN IMMEDIATE');
    applyChanges(p.db.raw, changes, p.device, () => p.wall(), p.env.newOpId);
    p.db.raw.exec('COMMIT');
  }
}

/** Feed `to` a shuffled, partly duplicated subset of `from`'s ops, bypassing the relay. */
function directDelivery(rng: () => number, from: Peer, to: Peer): void {
  const rows = from.db.raw.selectObjects('SELECT op_id, hlc, tbl, row_id, fields_json FROM change_log ORDER BY seq');
  const chosen: (typeof rows)[number][] = [];
  for (const r of rows) {
    if (rng() < 0.5) chosen.push(r);
    if (rng() < 0.2) chosen.push(r);
  }
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j]!, chosen[i]!];
  }
  const ops = chosen.map((r) => {
    const w: OpWire = { op: r.op_id as string, hlc: r.hlc as string, tbl: r.tbl as string, row: r.row_id as string, fields: JSON.parse(r.fields_json as string) as OpWire['fields'] };
    const p = parseRemoteOp(w, from.device);
    if (!p.ok) throw new Error('bad op in change_log');
    return p.value;
  });
  to.db.applyRemoteOps(ops, () => to.wall());
}

const dump = (p: Peer): string =>
  JSON.stringify(
    ['items ORDER BY id', 'reading_events ORDER BY id', 'duplicate_dismissals ORDER BY id', 'field_clock ORDER BY tbl, row_id, field'].map((t) =>
      p.db.raw.selectArrays(`SELECT * FROM ${t}`),
    ),
  );

/** Every peer runs until two whole rounds bring and send nothing. */
async function untilQuiet(peers: Peer[]): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < 12 && quiet < 2; round++) {
    let moved = 0;
    for (const p of peers) {
      p.tick(1000);
      const r = await p.engine.run('manual');
      if (r.problem) throw new Error(`run problem: ${r.problem}`);
      moved += r.pulled + r.pushed;
    }
    quiet = moved === 0 ? quiet + 1 : 0;
  }
  if (quiet < 2) throw new Error('did not go quiet in 12 rounds');
}

const stats = { ops: 0, items: 0, events: 0 };

async function oneRun(seed: number): Promise<void> {
  const rng = prng(seed);
  const relay = fakeRelay();
  const n = int(rng, 2, 5);
  const peers: Peer[] = [];
  try {
    for (let i = 1; i <= n; i++) peers.push(makePeer(i, relay, prng(seed * 31 + i), T0 + int(rng, -3_600_000, 3_600_000)));
    expect((await peers[0]!.engine.turnOn()).ok).toBe(true);
    const code = peers[0]!.engine.showCode()!.code;
    for (const p of peers.slice(1)) expect((await p.engine.join(code)).ok).toBe(true);

    const steps = int(rng, 20, 60);
    for (let s = 0; s < steps; s++) {
      const p = pick(rng, peers);
      const a = rng();
      if (a < 0.55) localWrite(rng, p);
      else if (a < 0.85) {
        p.tick(int(rng, 1, 3000));
        const r = await p.engine.run('manual');
        if (r.problem) throw new Error(`run problem: ${r.problem}`);
      } else {
        const from = pick(rng, peers.filter((q) => q !== p));
        directDelivery(rng, from, p);
      }
    }
    await untilQuiet(peers);
    const first = dump(peers[0]!);
    for (const p of peers.slice(1)) {
      if (dump(p) !== first) throw new Error(`peer ${p.n} differs from peer 1 (${n} peers, ${steps} steps)`);
    }
    stats.ops += Number(peers[0]!.db.raw.selectValue('SELECT COUNT(*) FROM change_log'));
    stats.items += Number(peers[0]!.db.raw.selectValue('SELECT COUNT(*) FROM items'));
    stats.events += Number(peers[0]!.db.raw.selectValue('SELECT COUNT(*) FROM reading_events'));
    for (const p of peers) {
      if (p.db.raw.selectValue('SELECT COUNT(*) FROM sync_inbox') !== 0) throw new Error(`peer ${p.n} has a stuck inbox`);
    }
  } finally {
    for (const p of peers) p.close();
  }
}

describe('convergence (SC-003)', () => {
  it(`${RUNS} seeded runs of 2-5 peers end with identical data`, { timeout: 900_000 }, async () => {
    const t0 = performance.now();
    for (let seed = 1; seed <= RUNS; seed++) {
      try {
        await oneRun(seed);
      } catch (e) {
        console.error(`CONVERGENCE FAILED, seed=${seed}`);
        throw new Error(`seed=${seed}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
    console.log(`convergence: ${RUNS} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s (${JSON.stringify(stats)} converged ops/items/events in total)`);
  });
});

describe('perf (SC-004)', () => {
  it('10k ops push to an empty space and a second peer pulls them, each under 60 s', { timeout: 300_000 }, async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay);
    let i = 0;
    while (a.db.pendingCount() < 10_000) {
      a.tick();
      const id = newId();
      a.db.dispatch({ kind: 'AddBook', itemId: id, title: `Book ${i}`, startNow: true, startEventId: newId(), localDate: '2026-09-01' }, a.env);
      if (++i % 3 === 0) a.db.dispatch({ kind: 'EditBook', itemId: id, author: `A${i}` }, a.env);
    }
    const ops = a.db.pendingCount();
    let t = performance.now();
    expect((await a.engine.turnOn()).ok).toBe(true);
    const pushMs = performance.now() - t;
    expect(a.db.pendingCount()).toBe(0);

    const b = makePeer(2, relay);
    t = performance.now();
    expect((await b.engine.join(a.engine.showCode()!.code)).ok).toBe(true);
    const pullMs = performance.now() - t;
    console.log(`perf: ${ops} ops, push ${(pushMs / 1000).toFixed(2)} s, join+pull ${(pullMs / 1000).toFixed(2)} s`);
    expect(pushMs).toBeLessThan(60_000);
    expect(pullMs).toBeLessThan(60_000);
    expect(b.db.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(ops);
    expect(dump(b)).toBe(dump(a));
    a.close();
    b.close();
  });
});

describe('free-tier usage (FR-023, SC-007, research R1)', () => {
  it('a simulated day of 3 devices stays under 10% of the free allowance', { timeout: 300_000 }, async () => {
    const relay: FakeRelay = fakeRelay();
    const rng = prng(2026);
    const peers = [1, 2, 3].map((n) => makePeer(n, relay, prng(n)));
    expect((await peers[0]!.engine.turnOn()).ok).toBe(true);
    for (const p of peers.slice(1)) expect((await p.engine.join(peers[0]!.engine.showCode()!.code)).ok).toBe(true);
    const base = { ...relay.counts };

    // Per device: 50 opens, 50 foregrounds, 100 local writes (each triggers a push-run), 20 sync taps.
    const todo = peers.flatMap((p) => [
      ...Array<[Peer, 'start' | 'visible' | 'write' | 'manual']>(50).fill([p, 'start']),
      ...Array<[Peer, 'start' | 'visible' | 'write' | 'manual']>(50).fill([p, 'visible']),
      ...Array<[Peer, 'start' | 'visible' | 'write' | 'manual']>(100).fill([p, 'write']),
      ...Array<[Peer, 'start' | 'visible' | 'write' | 'manual']>(20).fill([p, 'manual']),
    ]);
    for (let i = todo.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [todo[i], todo[j]] = [todo[j]!, todo[i]!];
    }
    for (const [p, reason] of todo) {
      p.tick(int(rng, 1000, 60_000));
      if (reason === 'write') {
        localWrite(rng, p);
        const r = await p.engine.run('write');
        expect(r.problem).toBeNull();
      } else {
        expect((await p.engine.run(reason)).problem).toBeNull();
      }
    }
    const used = { requests: relay.counts.requests - base.requests, reads: relay.counts.reads - base.reads, writes: relay.counts.writes - base.writes };
    console.log(`usage for a day of 3 devices: ${JSON.stringify(used)} (free: 100000 requests, 5000000 reads, 100000 writes)`);
    expect(used.requests).toBeLessThan(10_000);
    expect(used.reads).toBeLessThan(500_000);
    expect(used.writes).toBeLessThan(10_000);
    peers.forEach((p) => p.close());
  });
});

