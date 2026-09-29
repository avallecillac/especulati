import { describe, expect, it } from 'vitest';
import { decide, deriveStatus, lastPage, type BookSnapshot, type Change, type Command, type Item, type ReadingEvent, type EventType } from '../src/index.ts';
import { applyToSnapshot, book, day, eventId, instant, itemId, NOW, uuid, event } from './fixtures.ts';

const S = itemId(1);
const D = itemId(2);
const early = instant('2026-09-01T00:00:00.000Z');
const late = instant('2026-09-02T00:00:00.000Z');
const ev = (n: number, item: string, type: EventType, page: number | null = null, date = '2026-09-03'): ReadingEvent =>
  event({ id: eventId(n), itemId: item as ReadingEvent['itemId'], type, page: page as ReadingEvent['page'], occurredAt: instant(`${date}T08:00:00.000Z`), localDate: day(date) });
const copyId = (n: number) => uuid(0x5000 + n);

const merge = (survivorId: string, duplicateId: string, copies: Extract<Command, { kind: 'MergeBooks' }>['copies']): Command => ({ kind: 'MergeBooks', survivorId, duplicateId, copies });
const copiesFor = (events: readonly ReadingEvent[], base = 0) => events.filter((e) => e.deletedAt === null).map((e, i) => ({ from: e.id, to: copyId(base + i) }));

const s0 = (p: Partial<Item> = {}, evs: ReadingEvent[] = []): BookSnapshot => ({ item: book({ id: S, createdAt: early, ...p }), events: evs });
const d0 = (p: Partial<Item> = {}, evs: ReadingEvent[] = []): BookSnapshot => ({ item: book({ id: D, createdAt: late, ...p }), events: evs });

const run = (books: BookSnapshot[], c: Command) => decide({ books }, c, NOW);
const changes = (books: BookSnapshot[], c: Command): readonly Change[] => {
  const r = run(books, c);
  if (!r.ok) throw new Error(`rejected: ${JSON.stringify(r.error)}`);
  return r.value.changes;
};

describe('decide: MergeBooks rejections', () => {
  it('malformed ids -> InvalidInput', () => {
    expect(run([s0(), d0()], merge('x', D, []))).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'survivorId' } });
    expect(run([s0(), d0()], merge(S, 'x', []))).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'duplicateId' } });
  });
  it('missing or removed books -> NotFound', () => {
    expect(run([s0()], merge(S, D, []))).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(run([d0()], merge(S, D, []))).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(run([s0({ deletedAt: NOW }), d0()], merge(S, D, []))).toEqual({ ok: false, error: { kind: 'NotFound' } });
    // a removed duplicate that was not merged into the survivor is not a sweep
    expect(run([s0(), d0({ deletedAt: NOW })], merge(S, D, []))).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(run([s0(), d0({ deletedAt: NOW, mergedInto: itemId(9) })], merge(S, D, []))).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
  it('same id -> InvalidInput duplicateId', () => {
    expect(run([s0()], merge(S, S, []))).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'duplicateId' } });
  });
  it('survivor not earliest -> InvalidInput survivorId (regular merge only)', () => {
    expect(run([s0({ createdAt: late }), d0({ createdAt: early })], merge(S, D, []))).toMatchObject({
      ok: false, error: { kind: 'InvalidInput', field: 'survivorId', reason: 'not earliest' },
    });
    // equal createdAt: the smaller id wins
    expect(run([s0({ createdAt: early }), d0({ createdAt: early })], merge(D, S, []))).toMatchObject({ ok: false, error: { field: 'survivorId' } });
    expect(run([s0({ createdAt: early }), d0({ createdAt: early })], merge(S, D, [])).ok).toBe(true);
    // a sweep is exempt
    expect(run([s0({ createdAt: late }), d0({ createdAt: early, deletedAt: NOW, mergedInto: S })], merge(S, D, [])).ok).toBe(true);
  });
  it('copies.from must be exactly the duplicate live event ids', () => {
    const e1 = ev(1, D, 'started');
    const e2 = ev(2, D, 'progress', 5);
    const gone = { ...ev(3, D, 'progress', 9), deletedAt: NOW };
    const dup = d0({}, [e1, e2, gone]);
    const bad = (copies: Extract<Command, { kind: 'MergeBooks' }>['copies']) => run([s0(), dup], merge(S, D, copies));
    expect(bad([{ from: e1.id, to: copyId(1) }])).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'copies' } });
    expect(bad([{ from: e1.id, to: copyId(1) }, { from: e2.id, to: copyId(2) }, { from: gone.id, to: copyId(3) }])).toMatchObject({ ok: false, error: { field: 'copies' } });
    expect(bad([{ from: e1.id, to: copyId(1) }, { from: e1.id, to: copyId(2) }])).toMatchObject({ ok: false, error: { field: 'copies' } });
    expect(bad([{ from: e1.id, to: copyId(1) }, { from: uuid(4242), to: copyId(2) }])).toMatchObject({ ok: false, error: { field: 'copies' } });
    expect(bad(copiesFor([e1, e2])).ok).toBe(true);
  });
  it('a malformed or colliding `to` -> InvalidInput copies', () => {
    const e1 = ev(1, D, 'started');
    const se = ev(2, S, 'started');
    expect(run([s0({}, [se]), d0({}, [e1])], merge(S, D, [{ from: e1.id, to: 'nope' }]))).toMatchObject({ ok: false, error: { field: 'copies' } });
    // a `to` on a different book, or repeated within copies, is rejected
    expect(run([s0({}, [se]), d0({}, [e1])], merge(S, D, [{ from: e1.id, to: e1.id }]))).toMatchObject({ ok: false, error: { field: 'copies' } });
    const e2 = ev(3, D, 'progress', 4);
    expect(run([s0(), d0({}, [e1, e2])], merge(S, D, [{ from: e1.id, to: copyId(1) }, { from: e2.id, to: copyId(1) }]))).toMatchObject({ ok: false, error: { field: 'copies' } });
  });

  it('two identical-content entries on the duplicate share one `to`: inserted once, both sources tombstoned', () => {
    const e1 = ev(1, D, 'progress', 4);
    const twin = { ...e1, id: ev(2, D, 'progress', 4).id };
    const ch = changes([s0(), d0({}, [e1, twin])], merge(S, D, [{ from: e1.id, to: copyId(1) }, { from: twin.id, to: copyId(1) }]));
    expect(ch.filter((c) => c.tbl === 'reading_events').map((c) => [c.rowId, 'item_id' in c.fields])).toEqual([
      [copyId(1), true], [e1.id, false], [twin.id, false],
    ]);
  });

  it('skips the insert when `to` already exists on the survivor, but still tombstones the source', () => {
    const e1 = ev(1, D, 'started');
    const e2 = ev(2, D, 'progress', 4);
    const already = { ...ev(3, S, 'started'), id: copyId(1) as ReadingEvent['id'] };
    const ch = changes([s0({}, [already]), d0({}, [e1, e2])], merge(S, D, [{ from: e1.id, to: copyId(1) }, { from: e2.id, to: copyId(2) }]));
    expect(ch.filter((c) => c.tbl === 'reading_events').map((c) => [c.rowId, 'item_id' in c.fields])).toEqual([
      [copyId(2), true], [e1.id, false], [e2.id, false],
    ]);
  });
});

describe('decide: MergeBooks changes', () => {
  it('emits copies, tombstones, fills, then the duplicate tombstone with merged_into, in that order', () => {
    const e1 = ev(1, D, 'started', null, '2026-09-03');
    const e2 = ev(2, D, 'progress', 40, '2026-09-04');
    const ch = changes([s0({ totalPages: null }), d0({ author: 'Ann' as Item['author'], totalPages: 300 as Item['totalPages'], genre: 'SF' as Item['genre'] }, [e1, e2])], merge(S, D, copiesFor([e1, e2])));
    expect(ch).toEqual([
      { tbl: 'reading_events', rowId: copyId(0), fields: { item_id: S, event_type: 'started', page: null, occurred_at: e1.occurredAt, local_date: e1.localDate } },
      { tbl: 'reading_events', rowId: copyId(1), fields: { item_id: S, event_type: 'progress', page: 40, occurred_at: e2.occurredAt, local_date: e2.localDate } },
      { tbl: 'reading_events', rowId: e1.id, fields: { deleted_at: NOW } },
      { tbl: 'reading_events', rowId: e2.id, fields: { deleted_at: NOW } },
      { tbl: 'items', rowId: S, fields: { author: 'Ann', total_pages: 300, genre: 'SF' } },
      { tbl: 'items', rowId: D, fields: { deleted_at: NOW, merged_into: S } },
    ]);
  });

  it('fill-only-empty: never overwrites what the survivor has; no fill change when nothing to fill', () => {
    const ch = changes([s0({ author: 'Mine' as Item['author'] }), d0({ author: 'Theirs' as Item['author'] })], merge(S, D, []));
    expect(ch).toEqual([{ tbl: 'items', rowId: D, fields: { deleted_at: NOW, merged_into: S } }]);
  });

  it('fills isbn and cover_url too', () => {
    const ch = changes([s0({ totalPages: 300 as Item['totalPages'] }), d0({ isbn: '9780593135204' as Item['isbn'], coverUrl: 'https://c.example/a.jpg' as Item['coverUrl'] })], merge(S, D, []));
    expect(ch[0]).toEqual({ tbl: 'items', rowId: S, fields: { isbn: '9780593135204', cover_url: 'https://c.example/a.jpg' } });
  });

  it('total_pages guard: keeps the survivor null when it would fall below the max page logged across both', () => {
    const big = ev(1, S, 'progress', 250);
    const ch = changes([s0({ totalPages: null }, [big]), d0({ totalPages: 200 as Item['totalPages'] })], merge(S, D, []));
    expect(ch.find((c) => c.rowId === S)).toBeUndefined();
    const dupBig = ev(2, D, 'progress', 250);
    const ch2 = changes([s0({ totalPages: null }), d0({ totalPages: 200 as Item['totalPages'] }, [dupBig])], merge(S, D, copiesFor([dupBig])));
    expect(ch2.find((c) => c.rowId === S)).toBeUndefined();
    const ch3 = changes([s0({ totalPages: null }, [ev(3, S, 'progress', 200)]), d0({ totalPages: 200 as Item['totalPages'] })], merge(S, D, []));
    expect(ch3.find((c) => c.rowId === S)?.fields).toEqual({ total_pages: 200 });
  });

  it('sweep: emits copies and tombstones only, and accepts a merged_into chain via intermediate books', () => {
    const X = itemId(3);
    const T = itemId(4);
    const straggler = ev(1, X, 'progress', 10);
    const x = { item: book({ id: X, createdAt: instant('2026-09-05T00:00:00.000Z'), deletedAt: early, mergedInto: S, author: 'A' as Item['author'] }), events: [straggler] };
    const mid = s0({ createdAt: late, deletedAt: early, mergedInto: T });
    const t = { item: book({ id: T, createdAt: late }), events: [] };
    const ch = changes([x, mid, t], merge(T, X, copiesFor([straggler])));
    expect(ch).toEqual([
      { tbl: 'reading_events', rowId: copyId(0), fields: { item_id: T, event_type: 'progress', page: 10, occurred_at: straggler.occurredAt, local_date: straggler.localDate } },
      { tbl: 'reading_events', rowId: straggler.id, fields: { deleted_at: NOW } },
    ]);
    // chain that does not reach the survivor
    expect(run([x, t], merge(T, X, copiesFor([straggler])))).toEqual({ ok: false, error: { kind: 'NotFound' } });
    // survivor must be live in a sweep
    expect(run([x, { ...t, item: { ...t.item, deletedAt: NOW } }, mid], merge(T, X, copiesFor([straggler])))).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });

  it('sweep with no live events emits nothing', () => {
    const x = d0({ deletedAt: NOW, mergedInto: S });
    expect(changes([s0(), x], merge(S, D, []))).toEqual([]);
  });
});

// Deterministic PRNG for the property test (no Math.random in tests either: reproducible failures).
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const multiset = (evs: readonly ReadingEvent[]) =>
  evs.filter((e) => e.deletedAt === null).map((e) => `${e.type}|${e.page}|${e.occurredAt}|${e.localDate}`).sort();

describe('MergeBooks invariants (property)', () => {
  it('M-1, M-2, M-3 hold for random event sets', () => {
    const types: EventType[] = ['started', 'progress', 'progress', 'finished', 'abandoned'];
    for (let seed = 1; seed <= 300; seed++) {
      const rng = prng(seed);
      let n = 100;
      const gen = (item: string): ReadingEvent[] =>
        Array.from({ length: Math.floor(rng() * 8) }, () => {
          const type = types[Math.floor(rng() * types.length)]!;
          const day2 = `2026-09-${String(1 + Math.floor(rng() * 9)).padStart(2, '0')}`;
          // Unique instants: events tied on (date, time, rank) are ordered by id, and a copy has a new id.
          const e = { ...ev(++n + seed * 1000, item, type, type === 'progress' ? 1 + Math.floor(rng() * 90) : null, day2), occurredAt: instant(`${day2}T08:00:00.${String(n).padStart(3, '0')}Z`) };
          return rng() < 0.15 ? { ...e, deletedAt: NOW } : e;
        });
      const se = gen(S);
      const de = gen(D);
      const books = [s0({ totalPages: null }, se), d0({ totalPages: rng() < 0.5 ? (50 + Math.floor(rng() * 100)) as Item['totalPages'] : null }, de)];
      const c = merge(S, D, copiesFor(de, 50));
      const r1 = decide({ books }, c, NOW);
      const r2 = decide({ books }, c, NOW);
      expect(r1).toEqual(r2); // M-3
      if (!r1.ok) throw new Error(`seed ${seed}: ${JSON.stringify(r1.error)}`);

      // Apply to one pool holding both books' events: copies land on S, tombstones stay on the old rows.
      const combined = applyToSnapshot({ item: books[0]!.item, events: [...se, ...de] }, r1.value.changes.filter((x) => !(x.tbl === 'items' && x.rowId === D)));
      const after = { item: combined!.item, events: combined!.events.filter((e) => e.itemId === S) };

      const union = [...se, ...de];
      expect(multiset(after.events)).toEqual(multiset(union)); // M-1
      const single = union.filter((e) => e.deletedAt === null);
      expect(deriveStatus(after.events)).toBe(deriveStatus(single)); // M-2
      expect(lastPage(after.events)).toBe(lastPage(single));
    }
  });
});
