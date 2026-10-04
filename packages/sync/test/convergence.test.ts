// Convergence (research R11, SC-003), the 10k-op perf case (SC-004) and the free-tier usage
// measurement (research R1, FR-023, SC-007). All randomness is a seeded PRNG in this file.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseRemoteOp, type EventType, type OpWire } from '@readerlog/core';
import { parseSyncCode } from '../src/code.ts';
import { deriveKeys } from '../src/keys.ts';
import { open } from '../src/envelope.ts';
import { createRelayClient } from '../src/relayClient.ts';
import { fakeRelay, makePeer, prng, uuid, type FakeRelay, type Peer } from './harness.ts';

// SC-003 requires 1,000 runs: `pnpm test:convergence`. The everyday `pnpm test` runs 200.
const RUNS = Number(process.env['CONVERGENCE_RUNS'] ?? 200);
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const TYPES: EventType[] = ['started', 'progress', 'progress', 'finished', 'abandoned'];

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

let idN = 0x40000000;
const newId = () => uuid(++idN);

/** Same derivation as apps/pwa/src/lib/ids.ts (SHA-256, first 16 bytes, v4/variant bits), via node:crypto. */
function hashId(label: string): string {
  const b = createHash('sha256').update(label).digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Content-addressed v2 copy id, as in apps/pwa/src/lib/ids.ts: the source event's content, read from `p`. */
const mergeCopyId = (p: Peer, survivor: string, event: string): string => {
  const r = p.db.raw.selectObject('SELECT event_type, page, occurred_at, local_date FROM reading_events WHERE id = ?', [event])!;
  const page = r.page === null ? '' : (r.page as number);
  return hashId(`readerlog-merge-v2|${survivor}|${r.event_type as string}|${page}|${r.occurred_at as string}|${r.local_date as string}`);
};
const dismissalId = (a: string, b: string) => hashId(`readerlog-dismiss-v1|${a < b ? a : b}|${a < b ? b : a}`);

const liveEventIds = (p: Peer, item: string): string[] =>
  p.db.raw.selectValues('SELECT id FROM reading_events WHERE item_id = ? AND deleted_at IS NULL ORDER BY id', [item]).map(String);

/** MergeBooks with the deterministic copy ids the shell would compute. `survivor` defaults to the earlier book. */
function mergeBooks(p: Peer, a: string, b: string) {
  const created = (id: string) => p.db.raw.selectValue('SELECT created_at FROM items WHERE id = ?', [id]) as string;
  const aFirst = created(a) !== created(b) ? created(a) < created(b) : a < b;
  const [survivorId, duplicateId] = aFirst ? [a, b] : [b, a];
  const copies = liveEventIds(p, duplicateId).map((from) => ({ from, to: mergeCopyId(p, survivorId, from) }));
  return p.db.dispatch({ kind: 'MergeBooks', survivorId, duplicateId, copies }, p.env);
}

/**
 * The sweep (T028 ships the real one): every live event still on a merged-away book moves to the
 * final live book at the end of its merged_into chain. Returns how many books were swept.
 */
function sweep(p: Peer): number {
  const stragglers = p.db.raw.selectValues(
    'SELECT DISTINCT e.item_id FROM reading_events e JOIN items i ON i.id = e.item_id WHERE e.deleted_at IS NULL AND i.merged_into IS NOT NULL ORDER BY e.item_id',
  ).map(String);
  let swept = 0;
  for (const item of stragglers) {
    let target = item;
    const seen = new Set([item]);
    for (;;) {
      const row = p.db.raw.selectObject('SELECT deleted_at, merged_into FROM items WHERE id = ?', [target]);
      if (!row || row.deleted_at === null) break;
      const next = row.merged_into;
      if (typeof next !== 'string' || seen.has(next)) { target = ''; break; }
      seen.add(next);
      target = next;
    }
    if (target === '' || target === item) continue;
    const copies = liveEventIds(p, item).map((from) => ({ from, to: mergeCopyId(p, target, from) }));
    const r = p.db.dispatch({ kind: 'MergeBooks', survivorId: target, duplicateId: item, copies }, p.env);
    if (r.ok) swept++;
  }
  return swept;
}

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
  } else if (items.length >= 2 && kind < 0.97) {
    const [a, b] = [pick(rng, items), pick(rng, items)];
    if (a !== b) mergeBooks(p, a, b);
  } else if (items.length >= 2) {
    const [a, b] = [pick(rng, items), pick(rng, items)];
    if (a !== b) p.db.dispatch({ kind: 'DismissDuplicate', dismissalId: dismissalId(a, b), itemA: a, itemB: b }, p.env);
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

const stats = { ops: 0, items: 0, events: 0, merged: 0, swept: 0, dismissed: 0 };

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
    // Stragglers: sweep on every peer until nothing is left on a merged-away book (FR-029).
    for (let pass = 0; pass < 6; pass++) {
      let swept = 0;
      for (const p of peers) swept += sweep(p);
      stats.swept += swept;
      if (swept === 0) break;
      await untilQuiet(peers);
    }
    const first = dump(peers[0]!);
    for (const p of peers.slice(1)) {
      if (dump(p) !== first) throw new Error(`peer ${p.n} differs from peer 1 (${n} peers, ${steps} steps)`);
    }
    stats.ops += Number(peers[0]!.db.raw.selectValue('SELECT COUNT(*) FROM change_log'));
    stats.items += Number(peers[0]!.db.raw.selectValue('SELECT COUNT(*) FROM items'));
    stats.merged += Number(peers[0]!.db.raw.selectValue('SELECT COUNT(*) FROM items WHERE merged_into IS NOT NULL'));
    stats.dismissed += Number(peers[0]!.db.raw.selectValue('SELECT COUNT(*) FROM duplicate_dismissals'));
    stats.events += Number(peers[0]!.db.raw.selectValue('SELECT COUNT(*) FROM reading_events'));
    for (const p of peers) {
      if (sweep(p) !== 0) throw new Error(`peer ${p.n} still has stragglers after sweeping`);
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

describe('merge stragglers (FR-029, research R8)', () => {
  /** Two peers on one space, with T (oldest), S and X added by A and synced to B. */
  async function setup(count: 2 | 3 = 2) {
    const relay = fakeRelay();
    const peers = Array.from({ length: count }, (_, i) => makePeer(i + 1, relay));
    const [a, b] = [peers[0]!, peers[1]!];
    expect((await a.engine.turnOn()).ok).toBe(true);
    for (const p of peers.slice(1)) expect((await p.engine.join(a.engine.showCode()!.code)).ok).toBe(true);
    const [T, S, X] = [newId(), newId(), newId()];
    for (const id of [T, S, X]) {
      a.tick(1000);
      expect(a.db.dispatch({ kind: 'AddBook', itemId: id, title: `Same book`, totalPages: 400, startNow: true, startEventId: newId(), localDate: '2026-09-01' }, a.env).ok).toBe(true);
    }
    await untilQuiet(peers);
    return { relay, peers, a, b, T, S, X };
  }
  const log = (p: Peer, item: string, page: number) => {
    p.tick(1000);
    const id = newId();
    expect(p.db.dispatch({ kind: 'LogEvent', itemId: item, eventId: id, type: 'progress', page, localDate: '2026-09-02' }, p.env).ok).toBe(true);
    return id;
  };
  const closeAll = (peers: Peer[]) => peers.forEach((p) => p.close());

  it('an entry logged on X by B while A merges X into S ends up exactly once on S, on every peer', async () => {
    const { peers, a, b, S, X } = await setup(3);
    try {
      a.tick(1000);
      expect(mergeBooks(a, S, X).ok).toBe(true);
      const straggler = log(b, X, 77); // B has not synced yet
      await untilQuiet(peers);
      expect(liveEventIds(b, X)).toEqual([straggler]); // stranded on the removed book
      // Sweep on every peer before syncing: the deterministic ids make the copies identical.
      for (const p of peers) expect(sweep(p)).toBe(1);
      await untilQuiet(peers);
      const copy = mergeCopyId(b, S, straggler);
      for (const p of peers) {
        expect(liveEventIds(p, X)).toEqual([]);
        expect(liveEventIds(p, S)).toContain(copy);
        expect(liveEventIds(p, S).filter((e) => e === copy)).toHaveLength(1);
        expect(p.db.raw.selectValue("SELECT COUNT(*) FROM reading_events WHERE item_id = ? AND page = 77 AND deleted_at IS NULL", [S])).toBe(1);
        expect(sweep(p)).toBe(0);
      }
      expect(dumpAll(peers)).toBe(true);
    } finally {
      closeAll(peers);
    }
  });

  it('a chain X -> S then S -> T moves a straggler on X to T', async () => {
    const { peers, a, b, T, S, X } = await setup(2);
    try {
      log(a, X, 10); // synced-in entry already on X, merged along with it
      expect(mergeBooks(a, S, X).ok).toBe(true);
      const straggler = log(b, X, 88); // B is offline from the merges
      expect(mergeBooks(a, T, S).ok).toBe(true);
      await untilQuiet(peers);
      expect(liveEventIds(b, X)).toEqual([straggler]);
      expect(sweep(b)).toBe(1);
      await untilQuiet(peers);
      for (const p of peers) {
        expect(liveEventIds(p, X)).toEqual([]);
        expect(liveEventIds(p, S)).toEqual([]);
        expect(liveEventIds(p, T)).toContain(mergeCopyId(b, T, straggler));
        expect(p.db.raw.selectValue('SELECT COUNT(*) FROM reading_events WHERE item_id = ? AND page = 88 AND deleted_at IS NULL', [T])).toBe(1);
        expect(p.db.raw.selectValue('SELECT COUNT(*) FROM reading_events WHERE item_id = ? AND page = 10 AND deleted_at IS NULL', [T])).toBe(1);
        expect(sweep(p)).toBe(0);
      }
      expect(dumpAll(peers)).toBe(true);
    } finally {
      closeAll(peers);
    }
  });

  it('multi-path sweeps: A sweeps e straight to T while stale B sweeps it to S, then S -> T; T holds e once', async () => {
    const { peers, a, b, T, S, X } = await setup(3);
    try {
      const e = log(b, X, 99); // B logs while it still sees X as live
      expect(mergeBooks(a, S, X).ok).toBe(true);
      directDelivery(() => 0, a, b); // B learns X -> S, but not the later S -> T
      a.tick(1000);
      expect(mergeBooks(a, T, S).ok).toBe(true);
      directDelivery(() => 0, b, a); // A receives e (and knows S -> T)
      expect(sweep(a)).toBe(1); // straight to T
      expect(sweep(b)).toBe(1); // to S, the only live book B knows on the chain
      expect(b.db.raw.selectValue('SELECT COUNT(*) FROM reading_events WHERE item_id = ? AND page = 99 AND deleted_at IS NULL', [S])).toBe(1);
      await untilQuiet(peers);
      for (let pass = 0; pass < 4; pass++) {
        let n = 0;
        for (const p of peers) n += sweep(p);
        if (n === 0) break;
        await untilQuiet(peers);
      }
      for (const p of peers) {
        expect(liveEventIds(p, X)).toEqual([]);
        expect(p.db.raw.selectValue('SELECT COUNT(*) FROM reading_events WHERE item_id = ? AND page = 99 AND deleted_at IS NULL', [S])).toBe(0);
        expect(p.db.raw.selectValue('SELECT COUNT(*) FROM reading_events WHERE item_id = ? AND page = 99 AND deleted_at IS NULL', [T])).toBe(1);
      }
      expect(e).toBeTruthy();
      expect(dumpAll(peers)).toBe(true);
    } finally {
      closeAll(peers);
    }
  });

  it('a straggler swept onto S before S is merged into T follows to T (a copy of a copy)', async () => {
    const { peers, a, b, T, S, X } = await setup(2);
    try {
      expect(mergeBooks(a, S, X).ok).toBe(true);
      const straggler = log(b, X, 55);
      await untilQuiet(peers);
      expect(sweep(a)).toBe(1); // lands on S
      await untilQuiet(peers);
      expect(mergeBooks(a, T, S).ok).toBe(true);
      await untilQuiet(peers);
      for (const p of peers) {
        expect(liveEventIds(p, X)).toEqual([]);
        expect(liveEventIds(p, S)).toEqual([]);
        expect(p.db.raw.selectValue('SELECT COUNT(*) FROM reading_events WHERE item_id = ? AND page = 55 AND deleted_at IS NULL', [T])).toBe(1);
      }
      expect(straggler).toBeTruthy();
      expect(dumpAll(peers)).toBe(true);
    } finally {
      closeAll(peers);
    }
  });
});

function dumpAll(peers: Peer[]): boolean {
  const first = dump(peers[0]!);
  return peers.every((p) => dump(p) === first);
}

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


// 007, research R2 / contracts/sync-tiers.md. A device on 0.7.0 (v3) rejects any batch containing a
// `highlights` op, skips it and moves its cursor on. Highlights go out in their own batches, so that
// skipped batch never holds a base op; after the upgrade (migration 4 resets the cursor) it re-reads.
describe('forward compatibility: a v3 peer (007 T007)', () => {
  const V3_SEEDS = Number(process.env['V3_RUNS'] ?? 100);
  const fullDump = (p: Peer): string =>
    JSON.stringify(
      ['items ORDER BY id', 'reading_events ORDER BY id', 'highlights ORDER BY id', 'duplicate_dismissals ORDER BY id', 'field_clock ORDER BY tbl, row_id, field'].map((t) =>
        p.db.raw.selectArrays(`SELECT * FROM ${t}`),
      ),
    );
  const baseDump = (p: Peer): string =>
    JSON.stringify([
      p.db.raw.selectArrays('SELECT * FROM items ORDER BY id'),
      p.db.raw.selectArrays('SELECT * FROM reading_events ORDER BY id'),
      p.db.raw.selectArrays("SELECT * FROM field_clock WHERE tbl <> 'highlights' ORDER BY tbl, row_id, field"),
    ]);

  /** What 0.7.0 does on a pull: a batch with an op it can't parse (any `highlights` op) is skipped whole, and counted. */
  async function v3Pull(p: Peer, code: string, relay: ReturnType<typeof fakeRelay>): Promise<number> {
    const k = parseSyncCode(code);
    if (!k.ok) throw new Error('code');
    const keys = await deriveKeys(k.value);
    const client = createRelayClient(relay.fetch, keys.spaceId, keys.authToken, () => true);
    let applied = 0;
    for (let more = true; more; ) {
      const cursor = p.db.syncMeta().cursor;
      const page = await client.getBatches(cursor, 100);
      if (!page.ok) throw new Error(`pull ${page.kind}`);
      const ops: ReturnType<typeof parseRemoteOp> extends infer R ? (R extends { ok: true; value: infer V } ? V[] : never) : never = [];
      let skipped = 0;
      let last = cursor;
      for (const b of page.value.batches) {
        last = b.seq;
        const opened = await open(b, keys.encKey, keys.spaceId);
        if (!opened.ok) { skipped++; continue; }
        if (opened.value.ops.some((w) => w.tbl === 'highlights')) { skipped++; continue; }
        for (const w of opened.value.ops) {
          const r = parseRemoteOp(w, opened.value.device);
          if (!r.ok) throw new Error('v3 peer could not parse a base op');
          ops.push(r.value);
        }
      }
      if (last !== cursor) applied += p.db.applyPulledPage(ops, last, () => p.wall()).applied;
      if (skipped > 0) {
        const st = p.db.syncMeta().status;
        p.db.setSyncMeta({ status: { lastOkAt: st?.lastOkAt ?? null, problem: st?.problem ?? null, undecryptable: (st?.undecryptable ?? 0) + skipped } });
      }
      more = page.value.more;
    }
    return applied;
  }

  function write(rng: () => number, p: Peer, withHighlights: boolean): void {
    p.tick(int(rng, 1, 5000));
    const items = ids(p, 'SELECT id FROM items WHERE deleted_at IS NULL');
    const articles = ids(p, "SELECT id FROM items WHERE deleted_at IS NULL AND type = 'article'");
    const books = ids(p, "SELECT id FROM items WHERE deleted_at IS NULL AND type = 'book'");
    const k = rng();
    if (items.length === 0 || k < 0.2) {
      p.db.dispatch({ kind: 'AddBook', itemId: newId(), title: `Book ${int(rng, 0, 99)}`, startNow: rng() < 0.5, startEventId: newId(), localDate: '2026-09-01' }, p.env);
    } else if (k < 0.4) {
      const n = int(rng, 0, 9999);
      p.db.dispatch({ kind: 'AddArticle', itemId: newId(), url: `https://site${n}.example/post`, title: `Article ${n}`, author: null, wordCount: 500, readOn: '2026-09-01', detailsStatus: 'complete' }, p.env);
    } else if (k < 0.6 && books.length > 0) {
      p.db.dispatch({ kind: 'LogEvent', itemId: pick(rng, books), eventId: newId(), type: pick(rng, TYPES), page: int(rng, 1, 60), localDate: '2026-09-01' }, p.env);
    } else if (!withHighlights) {
      p.db.dispatch({ kind: 'EditBook', itemId: pick(rng, items), title: `Title ${int(rng, 0, 999)}`, author: null }, p.env);
    } else if (k < 0.85 && articles.length > 0) {
      p.db.dispatch({ kind: 'AddHighlight', highlightId: newId(), itemId: pick(rng, articles), quote: `Quote ${int(rng, 0, 999)}`, note: rng() < 0.5 ? `Note ${int(rng, 0, 99)}` : null, localDate: '2026-09-01' }, p.env);
    } else {
      const hs = p.db.raw.selectValues('SELECT id FROM highlights').map(String);
      if (hs.length === 0) return;
      const id = pick(rng, hs);
      const c = rng();
      if (c < 0.4) p.db.dispatch({ kind: 'EditHighlightNote', highlightId: id, note: `Edited ${int(rng, 0, 99)}` }, p.env);
      else if (c < 0.8) p.db.dispatch({ kind: 'RemoveHighlight', highlightId: id }, p.env);
      else p.db.dispatch({ kind: 'RestoreHighlight', highlightId: id }, p.env);
    }
  }

  async function quiet(full: Peer[], v3: Peer | null, code: string, relay: ReturnType<typeof fakeRelay>): Promise<void> {
    let calm = 0;
    for (let round = 0; round < 14 && calm < 2; round++) {
      let moved = 0;
      for (const p of full) {
        p.tick(1000);
        const r = await p.engine.run('manual');
        if (r.problem) throw new Error(`run problem: ${r.problem}`);
        moved += r.pulled + r.pushed;
      }
      if (v3) {
        v3.tick(1000);
        moved += await v3Pull(v3, code, relay);
        const r = await v3.engine.run('write', { pushOnly: true });
        if (r.problem) throw new Error(`run problem: ${r.problem}`);
        moved += r.pushed;
      }
      calm = moved === 0 ? calm + 1 : 0;
    }
    if (calm < 2) throw new Error('did not go quiet in 14 rounds');
  }

  const totals = { highlights: 0, skippedBatches: 0 };

  async function oneV3Run(seed: number): Promise<void> {
    const rng = prng(seed);
    const relay = fakeRelay();
    const peers = [1, 2, 3].map((i) => makePeer(i, relay, prng(seed * 31 + i), T0 + int(rng, -3_600_000, 3_600_000)));
    const [a, b, v] = [peers[0]!, peers[1]!, peers[2]!];
    try {
      expect((await a.engine.turnOn()).ok).toBe(true);
      const code = a.engine.showCode()!.code;
      expect((await b.engine.join(code)).ok).toBe(true);
      expect((await v.engine.join(code)).ok).toBe(true); // empty space: nothing for v3 to skip yet

      for (let s = 0, steps = int(rng, 25, 60); s < steps; s++) {
        const a1 = rng();
        if (a1 < 0.6) {
          const p = pick(rng, peers);
          write(rng, p, p !== v);
        } else {
          const p = pick(rng, peers);
          p.tick(int(rng, 1, 3000));
          if (p === v) {
            await v3Pull(v, code, relay);
            await v.engine.run('write', { pushOnly: true });
          } else {
            const r = await p.engine.run('manual');
            if (r.problem) throw new Error(`run problem: ${r.problem}`);
          }
        }
      }
      // Phase 1: v3 keeps skipping highlight batches but still gets every base op.
      await quiet([a, b], v, code, relay);
      if (baseDump(v) !== baseDump(a)) throw new Error('v3 peer is missing base ops (items/events) while highlights are in flight');
      if (baseDump(b) !== baseDump(a)) throw new Error('full peers disagree on base data');
      if (v.db.raw.selectValue('SELECT COUNT(*) FROM highlights') !== 0) throw new Error('v3 peer applied a highlight');
      const hl = Number(a.db.raw.selectValue("SELECT COUNT(*) FROM change_log WHERE tbl = 'highlights'"));
      totals.highlights += hl;
      const skipped = v.db.syncMeta().status?.undecryptable ?? 0;
      totals.skippedBatches += skipped;
      if (hl > 0 && skipped === 0) throw new Error('v3 peer should have skipped the highlight batches');

      // Phase 2: the upgrade. Migration 4 resets the cursor and the counter; the real engine re-reads everything.
      v.db.setSyncMeta({ cursor: 0, status: { lastOkAt: null, problem: null, undecryptable: 0 } });
      await quiet(peers, null, code, relay);
      const first = fullDump(a);
      for (const p of [b, v]) if (fullDump(p) !== first) throw new Error(`peer ${p.n} differs after the upgrade`);
      for (const p of peers) if (p.db.raw.selectValue('SELECT COUNT(*) FROM sync_inbox') !== 0) throw new Error(`peer ${p.n} has a stuck inbox`);
      if (Number(v.db.raw.selectValue('SELECT COUNT(*) FROM highlights')) !== Number(a.db.raw.selectValue('SELECT COUNT(*) FROM highlights'))) throw new Error('highlight counts differ');
    } finally {
      for (const p of peers) p.close();
    }
  }

  it(`${V3_SEEDS} seeded runs: the v3 peer loses no base op, and converges after upgrading`, { timeout: 600_000 }, async () => {
    const t0 = performance.now();
    for (let seed = 1; seed <= V3_SEEDS; seed++) {
      try {
        await oneV3Run(seed);
      } catch (e) {
        console.error(`V3 CONVERGENCE FAILED, seed=${seed}`);
        throw new Error(`seed=${seed}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
    console.log(`v3 peer: ${V3_SEEDS} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s (${JSON.stringify(totals)})`);
    expect(totals.highlights).toBeGreaterThan(0);
    expect(totals.skippedBatches).toBeGreaterThan(0);
  });
});
