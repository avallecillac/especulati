import { describe, expect, it } from 'vitest';
import {
  compareHlc, decide, hlcReceive, mergeOp, parseHlc, type Hlc, type Highlight, type HighlightId, type Instant, type Item, type ItemId,
  type ItemTagRow, type LocalDate, type ReconcileSnapshot, type RemoteOp,
} from '../src/index.ts';
import { book, deviceId, NOW, uuid } from './fixtures.ts';

/** mulberry32: small seeded PRNG so failures reproduce. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const h = (ms: number, counter: number, dev: number) =>
  `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${deviceId(dev)}` as Hlc;

describe('hlcReceive properties', () => {
  it('result > local and > remote, ms >= max(local, remote, wall)', () => {
    const rnd = prng(42);
    for (let i = 0; i < 2000; i++) {
      const local = rnd() < 0.1 ? null : h(Math.floor(rnd() * 20), rnd() < 0.2 ? 9999 : Math.floor(rnd() * 5), 1);
      const remote = h(Math.floor(rnd() * 20), rnd() < 0.2 ? 9999 : Math.floor(rnd() * 5), 2 + Math.floor(rnd() * 3));
      const wall = Math.floor(rnd() * 20);
      const r = hlcReceive(local, remote, wall, deviceId(1));
      expect(compareHlc(r, remote)).toBe(1);
      if (local) expect(compareHlc(r, local)).toBe(1);
      const ms = (x: Hlc) => (parseHlc(x) as { ok: true; value: { ms: number } }).value.ms;
      expect(ms(r)).toBeGreaterThanOrEqual(Math.max(local ? ms(local) : 0, ms(remote), wall));
    }
  });
});

const FIELDS = ['title', 'author', 'rating', 'genre'];
type State = Map<string, { value: unknown; clock: Hlc }>; // key: row|field

function applyAll(ops: readonly RemoteOp[]): State {
  const state: State = new Map();
  for (const op of ops) {
    const wins = mergeOp((f) => state.get(`${op.rowId}|${f}`)?.clock ?? null, op);
    for (const f of wins) state.set(`${op.rowId}|${f}`, { value: op.fields[f], clock: op.hlc });
  }
  return state;
}

describe('merge properties', () => {
  it('mergeOp: a field wins iff clock is null or op.hlc > clock', () => {
    const rnd = prng(7);
    for (let i = 0; i < 500; i++) {
      const opHlc = h(Math.floor(rnd() * 10), Math.floor(rnd() * 3), 2);
      const clocks: Record<string, Hlc | null> = {};
      for (const f of FIELDS) clocks[f] = rnd() < 0.3 ? null : h(Math.floor(rnd() * 10), Math.floor(rnd() * 3), 3);
      const op: RemoteOp = { opId: uuid(1), hlc: opHlc, deviceId: deviceId(2), tbl: 'items', rowId: uuid(1), fields: Object.fromEntries(FIELDS.map((f) => [f, 'v'])) };
      const wins = mergeOp((f) => clocks[f] ?? null, op);
      for (const f of FIELDS) expect(wins.includes(f)).toBe(clocks[f] === null || opHlc > (clocks[f] as Hlc));
    }
  });

  it('order independence over random permutations of 2..30 ops on 1..3 rows', () => {
    const rnd = prng(2026);
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rnd() * 29);
      const rows = 1 + Math.floor(rnd() * 3);
      const used = new Set<string>();
      const ops: RemoteOp[] = [];
      while (ops.length < n) {
        const dev = 2 + Math.floor(rnd() * 3);
        const hlc = h(Math.floor(rnd() * 8), Math.floor(rnd() * 3), dev);
        if (used.has(hlc)) continue; // HLCs are unique per device by construction
        used.add(hlc);
        const fields: Record<string, string | number | null> = {};
        for (const f of FIELDS) if (rnd() < 0.5) fields[f] = rnd() < 0.2 ? null : `v${ops.length}`;
        if (Object.keys(fields).length === 0) fields.title = `v${ops.length}`;
        ops.push({ opId: uuid(ops.length + 1), hlc, deviceId: deviceId(dev), tbl: 'items', rowId: uuid(1 + Math.floor(rnd() * rows)), fields });
      }
      const baseline = applyAll(ops);
      for (let p = 0; p < 4; p++) {
        const shuffled = [...ops];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }
        expect(applyAll(shuffled)).toEqual(baseline);
      }
    }
  });
});

describe('ReconcileSavedArticle properties (R-1, R-2)', () => {
  const S = uuid(50);
  const D = uuid(51);
  const art = (id: string, p: Partial<Item>): Item =>
    book({
      id: id as ItemId, type: 'article', title: 'T' as Item['title'], author: null, totalPages: null,
      url: 'https://e.com/a' as Item['url'], domain: 'e.com', wordCount: 10, readOn: null, ...p,
    });

  it('peers loading rows and copies in different orders decide deep-equal changes; the survivor change is the full row', () => {
    const rnd = prng(808);
    const shuffle = <T,>(xs: readonly T[]): T[] => {
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    for (let round = 0; round < 200; round++) {
      const nh = Math.floor(rnd() * 6);
      const na = Math.floor(rnd() * 6);
      const hs: Highlight[] = Array.from({ length: nh }, (_, i) => ({
        id: uuid(1000 + i) as HighlightId, itemId: D as ItemId, quote: `q${i}`, note: null, page: null,
        createdAt: '2026-09-05T10:00:00.000Z' as Instant, localDate: '2026-09-05' as LocalDate, deletedAt: rnd() < 0.2 ? ('2026-09-06T10:00:00.000Z' as Instant) : null,
      }));
      const as: ItemTagRow[] = Array.from({ length: na }, (_, i) => ({
        id: uuid(2000 + i), itemId: D, tagId: uuid(3000 + i), createdAt: '2026-09-05T10:00:00.000Z' as Instant, deletedAt: rnd() < 0.2 ? ('2026-09-06T10:00:00.000Z' as Instant) : null,
      }));
      const readOn = rnd() < 0.7 ? ('2026-09-05' as LocalDate) : null;
      const base = (): ReconcileSnapshot => ({
        survivor: art(S, { createdAt: '2026-09-01T10:00:00.000Z' as Instant }),
        duplicate: art(D, { createdAt: '2026-09-05T10:00:00.000Z' as Instant, readOn }),
        duplicateHighlights: hs, survivorHighlightIds: [], duplicateAssignments: as, survivorAssignments: [],
      });
      const copies = hs.filter((h) => h.deletedAt === null).map((h, i) => ({ from: h.id, to: uuid(4000 + i) }));
      const moves = as.filter((a) => a.deletedAt === null).map((a, i) => ({ from: a.id, to: uuid(5000 + i), itemId: S }));
      const peerA = decide(base(), { kind: 'ReconcileSavedArticle', survivorId: S, duplicateId: D, copies, tagMoves: moves }, NOW);
      const peerB = decide(
        { ...base(), duplicateHighlights: shuffle(hs), duplicateAssignments: shuffle(as) },
        { kind: 'ReconcileSavedArticle', survivorId: S, duplicateId: D, copies: shuffle(copies), tagMoves: shuffle(moves) },
        NOW,
      );
      expect(peerA.ok).toBe(true);
      expect(peerB).toEqual(peerA);
      if (peerA.ok) {
        // R-2: the survivor change carries every article insert field
        const f = peerA.value.changes[0]!.fields;
        for (const k of ['type', 'title', 'url', 'domain', 'author', 'word_count', 'metadata_status', 'created_at', 'read_on']) expect(k in f).toBe(true);
        expect(f['read_on']).toBe(readOn);
      }
    }
  });
});
