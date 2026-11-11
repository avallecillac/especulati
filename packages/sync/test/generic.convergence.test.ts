// Convergence of the generic sync plumbing, with no lector in sight: three peers over db-kit on a
// toy `notes` + `marks` (marks belong to a note) schema. Each run mixes local edits on every peer,
// then delivers the whole op pool to every peer in its own shuffled, paged, duplicated order, with
// children ahead of their parents on one peer and an LWW tie (same ms and counter, different
// device) injected. Every peer must end with identical tables. All randomness is seeded.
import { applyChanges, SqliteSyncStore } from '@especulati/db-kit';
import { parseRemoteOpWith, type DeviceId, type OpWire, type RemoteOp } from '@especulati/sync-core';
import { describe, expect, it } from 'vitest';
import { openToyDb, toyCanInsert, toySchema, uuid, type ToyTable } from '../../db-kit/test/helpers.ts';
import { prng } from './relayHarness.ts';

const RUNS = Number(process.env['CONVERGENCE_RUNS'] ?? 200);
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const parse = parseRemoteOpWith(toySchema);

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
function shuffle<T>(rng: () => number, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

interface Peer {
  device: DeviceId;
  store: SqliteSyncStore<ToyTable>;
  write(tbl: ToyTable, rowId: string, fields: Record<string, string | null>, wall: number): void;
  notes: string[];
  marks: string[];
  cursor: number;
}

function makePeer(n: number, run: number): Peer {
  const raw = openToyDb();
  const device = uuid(0xd000 + n) as DeviceId;
  raw.exec("UPDATE meta SET value = ? WHERE key = 'device_id'", { bind: [device] });
  let opN = 0;
  const peer: Peer = {
    device,
    store: new SqliteSyncStore(raw, toySchema, toyCanInsert),
    notes: [],
    marks: [],
    cursor: 0,
    write(tbl, rowId, fields, wall) {
      applyChanges(raw, toySchema, [{ tbl, rowId, fields }], device, () => wall, () => uuid(run * 0x100000 + n * 0x10000 + ++opN));
    },
  };
  return peer;
}

/** Every op a peer has logged, as it would travel. */
function logged(p: Peer): { w: OpWire; device: string }[] {
  const rows = p.store.raw.selectObjects('SELECT op_id, hlc, device_id, tbl, row_id, fields_json FROM change_log ORDER BY seq') as {
    op_id: string; hlc: string; device_id: string; tbl: string; row_id: string; fields_json: string;
  }[];
  return rows.map((r) => ({
    w: { op: r.op_id, hlc: r.hlc, tbl: r.tbl, row: r.row_id, fields: JSON.parse(r.fields_json) as OpWire['fields'] },
    device: r.device_id,
  }));
}

function dump(p: Peer): string {
  const q = (sql: string) => JSON.stringify(p.store.raw.selectArrays(sql));
  return [
    q('SELECT id, body, deleted_at FROM notes ORDER BY id'),
    q('SELECT id, note_id, label, deleted_at FROM marks ORDER BY id'),
    q('SELECT tbl, row_id, field, hlc FROM field_clock ORDER BY tbl, row_id, field'),
  ].join('\n');
}

function runOnce(run: number): void {
  const rng = prng(run + 1);
  const peers = [makePeer(1, run), makePeer(2, run), makePeer(3, run)];
  const id = (() => {
    let n = 0;
    return () => uuid(0x4000000 + run * 0x1000 + ++n);
  })();

  // A shared note every peer starts with, so concurrent edits and ties have something to hit.
  const shared = id();
  peers[0]!.write('notes', shared, { body: 'shared' }, T0);
  const first = logged(peers[0]!).map(({ w, device }) => parse(w, device));
  for (const p of peers) {
    p.notes.push(shared);
    if (p !== peers[0]) {
      const ops = first.map((r) => (r.ok ? r.value : null)).filter((o): o is RemoteOp<ToyTable> => o !== null);
      p.store.applyPulledPage(ops, ++p.cursor, () => T0);
    }
  }

  // Concurrent local activity.
  const pool: { w: OpWire; device: string }[] = [];
  for (const [i, p] of peers.entries()) {
    let wall = T0 + int(rng, 1, 500);
    const steps = int(rng, 3, 12);
    for (let s = 0; s < steps; s++) {
      wall += int(rng, 0, 400);
      const roll = rng();
      if (roll < 0.25) {
        const nid = id();
        p.write('notes', nid, { body: `n${i}-${s}` }, wall);
        p.notes.push(nid);
      } else if (roll < 0.55) {
        p.write('notes', pick(rng, p.notes), { body: `b${i}-${s}` }, wall);
      } else if (roll < 0.65) {
        p.write('notes', pick(rng, p.notes), { deleted_at: `2026-09-27T12:00:${String(s).padStart(2, '0')}Z` }, wall);
      } else if (roll < 0.9) {
        const mid = id();
        // Marks only on notes this peer made itself or the shared one, so every parent exists somewhere.
        p.write('marks', mid, { note_id: pick(rng, p.notes), label: `m${i}-${s}` }, wall);
        p.marks.push(mid);
      } else if (p.marks.length > 0) {
        p.write('marks', pick(rng, p.marks), { label: `m${i}-${s}-edit` }, wall);
      }
    }
    pool.push(...logged(p));
  }

  // An LWW tie: the same field of the shared note, same ms and counter, two devices.
  const tieMs = T0 + 10_000;
  const devX = uuid(0xeee1);
  const devY = uuid(0xeee2);
  const hlc = (dev: string) => `${String(tieMs).padStart(13, '0')}-0000-${dev}`;
  pool.push(
    { w: { op: uuid(0x7700000 + run * 4 + 1), hlc: hlc(devX), tbl: 'notes', row: shared, fields: { body: 'tie-x' } }, device: devX },
    { w: { op: uuid(0x7700000 + run * 4 + 2), hlc: hlc(devY), tbl: 'notes', row: shared, fields: { body: 'tie-y' } }, device: devY },
  );

  const parsed = pool.map(({ w, device }) => {
    const r = parse(w, device);
    if (!r.ok) throw new Error(`bad pool op: ${JSON.stringify(r.error)}`);
    return r.value;
  });

  // Delivery: each peer gets the whole pool once or more, in its own order, in pages.
  for (const [i, p] of peers.entries()) {
    let order = shuffle(rng, parsed);
    if (i === 2) order = [...order.filter((o) => o.tbl === 'marks'), ...order.filter((o) => o.tbl === 'notes')]; // children first
    order = [...order, ...shuffle(rng, parsed).slice(0, Math.floor(parsed.length / 2))]; // duplicates
    for (let at = 0; at < order.length; ) {
      const size = int(rng, 1, 7);
      p.store.applyPulledPage(order.slice(at, at + size), ++p.cursor, () => T0 + 60_000);
      at += size;
    }
  }

  const want = dump(peers[0]!);
  for (const p of peers) {
    expect(dump(p), `run ${run}`).toBe(want);
    expect(p.store.inboxOpIds(), `run ${run}: parked ops left over`).toEqual([]);
  }
  // The tie (the latest write to `shared.body` by far) went to the higher device id.
  expect(peers[0]!.store.raw.selectValue('SELECT body FROM notes WHERE id = ?', [shared]), `run ${run}`).toBe('tie-y');
  for (const p of peers) p.store.raw.close();
}

describe('generic convergence (toy notes + marks over db-kit)', () => {
  it(`${RUNS} seeded runs: three peers reach identical tables`, { timeout: 300_000 }, () => {
    for (let run = 0; run < RUNS; run++) runOnce(run);
  });

  it('an LWW tie (same ms and counter) goes to the higher device id, whatever the delivery order', () => {
    const devLow = uuid(0xaaa1);
    const devHigh = uuid(0xaaa2);
    const hlc = (dev: string) => `${String(T0).padStart(13, '0')}-0000-${dev}`;
    const mk = (dev: string, body: string, n: number) => {
      const r = parse({ op: uuid(0x9900 + n), hlc: hlc(dev), tbl: 'notes', row: uuid(0x55), fields: { body } }, dev);
      if (!r.ok) throw new Error('op');
      return r.value;
    };
    const low = mk(devLow, 'low', 1);
    const high = mk(devHigh, 'high', 2);
    for (const order of [[low, high], [high, low]]) {
      const p = makePeer(9, 0);
      p.store.applyPulledPage(order, 1, () => T0);
      expect(p.store.raw.selectValue('SELECT body FROM notes WHERE id = ?', [uuid(0x55)])).toBe('high');
      p.store.raw.close();
    }
  });
});
