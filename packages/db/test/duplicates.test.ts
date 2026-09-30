import { describe, expect, it } from 'vitest';
import { openTestDb, TODAY, uuid, type TestDb } from './helpers.ts';

const ISBN = '9780306406157';

function add(t: TestDb, n: number, title: string, extra: { isbn?: string; author?: string } = {}) {
  t.tick();
  const r = t.db.dispatch({ kind: 'AddBook', itemId: uuid(n), title, startNow: true, startEventId: uuid(0x1000 + n), localDate: '2026-09-01', ...extra }, t.env);
  expect(r).toMatchObject({ ok: true });
}
const merge = (t: TestDb, survivor: number, dup: number, to: (from: string) => string) => {
  t.tick();
  const copies = t.db.book(uuid(dup), TODAY)!.events.map((e) => ({ from: e.id, to: to(e.id) }));
  expect(t.db.dispatch({ kind: 'MergeBooks', survivorId: uuid(survivor), duplicateId: uuid(dup), copies }, t.env)).toMatchObject({ ok: true });
};

describe('duplicates query (US5)', () => {
  it('pairs live books with the same ISBN, survivor first, with entry counts', () => {
    const t = openTestDb();
    add(t, 1, 'Dune', { isbn: ISBN, author: 'Frank Herbert' });
    add(t, 2, 'dune!', { isbn: ISBN });
    add(t, 3, 'Emma');
    const pairs = t.db.duplicates();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.survivor).toMatchObject({ itemId: uuid(1), title: 'Dune', author: 'Frank Herbert', isbn: ISBN, entryCount: 1 });
    expect(pairs[0]!.duplicate).toMatchObject({ itemId: uuid(2), title: 'dune!', author: null, entryCount: 1 });
    expect(pairs[0]!.survivor.createdAt < pairs[0]!.duplicate.createdAt).toBe(true);
  });

  it('skips dismissed pairs and removed books', () => {
    const t = openTestDb();
    add(t, 1, 'Dune', { isbn: ISBN });
    add(t, 2, 'Dune', { isbn: ISBN });
    add(t, 3, 'Dune', { isbn: ISBN });
    t.tick();
    t.db.dispatch({ kind: 'RemoveBook', itemId: uuid(3) }, t.env);
    expect(t.db.duplicates()).toHaveLength(1);
    t.tick();
    t.db.dispatch({ kind: 'DismissDuplicate', dismissalId: uuid(0x99), itemA: uuid(2), itemB: uuid(1) }, t.env);
    expect(t.db.duplicates()).toEqual([]);
  });
});

describe('stragglers query (FR-029)', () => {
  it('finds live events on a merged-away book and targets the book it merged into', () => {
    const t = openTestDb();
    add(t, 1, 'Dune', { isbn: ISBN });
    add(t, 2, 'Dune', { isbn: ISBN });
    merge(t, 1, 2, (f) => '1111' + f.slice(4));
    expect(t.db.stragglers()).toEqual([]);
    // A remote entry arrives on the removed book.
    t.raw.exec(
      `INSERT INTO reading_events (id, item_id, event_type, page, occurred_at, local_date) VALUES (?, ?, 'progress', 50, '2026-09-03T10:00:00.000Z', '2026-09-03')`,
      { bind: [uuid(0x77), uuid(2)] },
    );
    expect(t.db.stragglers()).toEqual([
      { duplicateId: uuid(2), survivorId: uuid(1), events: [{ id: uuid(0x77), type: 'progress', page: 50, occurredAt: '2026-09-03T10:00:00.000Z', localDate: '2026-09-03' }] },
    ]);
  });

  it('follows the chain to the final live book', () => {
    const t = openTestDb();
    add(t, 1, 'Dune', { isbn: ISBN });
    add(t, 2, 'Dune', { isbn: ISBN });
    add(t, 3, 'Dune', { isbn: ISBN });
    merge(t, 2, 3, (f) => '2222' + f.slice(4));
    merge(t, 1, 2, (f) => '1111' + f.slice(4));
    t.raw.exec(
      `INSERT INTO reading_events (id, item_id, event_type, page, occurred_at, local_date) VALUES (?, ?, 'progress', 60, '2026-09-03T10:00:00.000Z', '2026-09-03')`,
      { bind: [uuid(0x78), uuid(3)] },
    );
    expect(t.db.stragglers().map((s) => [s.duplicateId, s.survivorId])).toEqual([[uuid(3), uuid(1)]]);
  });

  it('ignores a chain that ends at a removed book', () => {
    const t = openTestDb();
    add(t, 1, 'Dune', { isbn: ISBN });
    add(t, 2, 'Dune', { isbn: ISBN });
    merge(t, 1, 2, (f) => '1111' + f.slice(4));
    t.tick();
    t.db.dispatch({ kind: 'RemoveBook', itemId: uuid(1) }, t.env);
    t.raw.exec(
      `INSERT INTO reading_events (id, item_id, event_type, page, occurred_at, local_date) VALUES (?, ?, 'progress', 50, '2026-09-03T10:00:00.000Z', '2026-09-03')`,
      { bind: [uuid(0x77), uuid(2)] },
    );
    expect(t.db.stragglers()).toEqual([]);
  });
});
