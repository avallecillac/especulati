import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { openTestDb, uuid, type TestDb } from './helpers.ts';

const ISBN_A = '9780306406157';
const ISBN_B = '9780140328721';
const bytes = (...n: number[]) => new Uint8Array(n);

function add(t: TestDb, n: number, extra: Partial<Extract<Command, { kind: 'AddBook' }>> = {}) {
  t.tick();
  const r = t.db.dispatch({ kind: 'AddBook', itemId: uuid(n), title: `Book ${n}`, startNow: false, localDate: '2026-09-01', ...extra }, t.env);
  expect(r).toMatchObject({ ok: true });
}
// FillDetails is core's job; here we only need the stored column to vary.
const setStatus = (t: TestDb, n: number, s: string) =>
  t.raw.exec('UPDATE items SET metadata_status = ? WHERE id = ?', { bind: [s, uuid(n)] });
const logCount = (t: TestDb) => t.raw.selectValue('SELECT count(*) FROM change_log') as number;

describe('covers cache', () => {
  it('round-trips, upserts and deletes without touching change_log', () => {
    const t = openTestDb();
    add(t, 1);
    const before = logCount(t);
    expect(t.db.getCover(uuid(1))).toBeNull();
    t.db.putCover(uuid(1), bytes(1, 2, 3), 100, 150, '2026-09-01T00:00:00.000Z');
    expect(t.db.getCover(uuid(1))).toEqual({ mime: 'image/jpeg', bytes: bytes(1, 2, 3) });
    t.db.putCover(uuid(1), bytes(9), 100, 150, '2026-09-02T00:00:00.000Z');
    expect(t.db.getCover(uuid(1))?.bytes).toEqual(bytes(9));
    expect(t.raw.selectValue('SELECT count(*) FROM covers')).toBe(1);
    t.db.deleteCover(uuid(1));
    expect(t.db.getCover(uuid(1))).toBeNull();
    expect(logCount(t)).toBe(before);
    expect(t.raw.selectValue('SELECT count(*) FROM field_clock WHERE tbl = ?', ['covers'])).toBe(0);
  });

  it('CHECK rejects out-of-range sizes', () => {
    const t = openTestDb();
    add(t, 1);
    expect(() => t.db.putCover(uuid(1), bytes(1), 100, 481, 'x')).toThrow(/CHECK/);
    expect(() => t.db.putCover(uuid(1), bytes(1), 39, 100, 'x')).toThrow(/CHECK/);
  });
});

describe('BookCard 002 fields', () => {
  it('exposes isbn, detailsStatus and hasCover', () => {
    const t = openTestDb();
    add(t, 1, { isbn: ISBN_A, detailsStatus: 'pending' });
    add(t, 2);
    setStatus(t, 1, 'failed');
    t.db.putCover(uuid(2), bytes(1), 100, 150, 'x');
    const cards = t.db.library().queued;
    const c1 = cards.find((c) => c.itemId === uuid(1))!;
    const c2 = cards.find((c) => c.itemId === uuid(2))!;
    expect(c1).toMatchObject({ isbn: ISBN_A, detailsStatus: 'notFound', hasCover: false });
    expect(c2).toMatchObject({ isbn: null, detailsStatus: 'complete', hasCover: true });
    expect(t.db.book(uuid(2))?.card.hasCover).toBe(true);
  });

  it('maps ok to complete and pending to pending', () => {
    const t = openTestDb();
    add(t, 1, { isbn: ISBN_A, detailsStatus: 'pending' });
    expect(t.db.book(uuid(1))?.card.detailsStatus).toBe('pending');
    setStatus(t, 1, 'ok');
    expect(t.db.book(uuid(1))?.card.detailsStatus).toBe('complete');
  });
});

describe('findByIsbn and pendingDetails', () => {
  it('finds a non-removed book, null after RemoveBook', () => {
    const t = openTestDb();
    add(t, 1, { isbn: ISBN_A });
    expect(t.db.findByIsbn(ISBN_A)?.itemId).toBe(uuid(1));
    expect(t.db.findByIsbn(ISBN_B)).toBeNull();
    t.tick();
    t.db.dispatch({ kind: 'RemoveBook', itemId: uuid(1) }, t.env);
    expect(t.db.findByIsbn(ISBN_A)).toBeNull();
  });

  it('lists only pending, non-removed books with an ISBN', () => {
    const t = openTestDb();
    add(t, 1, { isbn: ISBN_A, detailsStatus: 'pending' });
    add(t, 2, { isbn: ISBN_B, detailsStatus: 'complete' });
    add(t, 3, { detailsStatus: 'pending' });
    add(t, 4, { isbn: '9780262033848', detailsStatus: 'pending' });
    t.tick();
    t.db.dispatch({ kind: 'RemoveBook', itemId: uuid(4) }, t.env);
    expect(t.db.pendingDetails()).toEqual([{ itemId: uuid(1), isbn: ISBN_A }]);
  });
});

describe('missingCovers (FR-016)', () => {
  it('lists live books with a cover_url and no cached cover', () => {
    const t = openTestDb();
    add(t, 1, { coverUrl: 'https://example.test/1.jpg' });
    add(t, 2, { coverUrl: 'https://example.test/2.jpg' });
    add(t, 3);
    add(t, 4, { coverUrl: 'https://example.test/4.jpg' });
    t.db.putCover(uuid(2), bytes(1), 100, 150, '2026-09-01T00:00:00.000Z');
    t.tick();
    t.db.dispatch({ kind: 'RemoveBook', itemId: uuid(4) }, t.env);
    expect(t.db.missingCovers()).toEqual([{ itemId: uuid(1), coverUrl: 'https://example.test/1.jpg' }]);
  });
});

describe('coverStats (FR-010 budget visibility)', () => {
  it('counts stored covers and their bytes; deleteCover brings it back to zero', () => {
    const t = openTestDb();
    expect(t.db.coverStats()).toEqual({ count: 0, bytes: 0 });
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(71), title: 'With cover', startNow: false, localDate: '2026-09-28' }, t.env);
    t.db.putCover(uuid(71), new Uint8Array(1234), 300, 450, '2026-09-28T00:00:00.000Z');
    expect(t.db.coverStats()).toEqual({ count: 1, bytes: 1234 });
    t.db.deleteCover(uuid(71));
    expect(t.db.coverStats()).toEqual({ count: 0, bytes: 0 });
  });
});
