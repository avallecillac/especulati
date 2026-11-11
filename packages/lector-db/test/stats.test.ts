import { describe, expect, it } from 'vitest';
import type { Command } from '@especulati/lector-core';
import { loadStatsBooks } from '../src/index.ts';
import { openTestDb, uuid, type TestDb } from './helpers.ts';

function harness() {
  const t = openTestDb();
  const run = (cmd: Command) => { t.tick(); expect(t.db.dispatch(cmd, t.env)).toMatchObject({ ok: true }); };
  const add = (n: number, title: string, opts: { start?: boolean; genre?: string; totalPages?: number; date?: string } = {}) =>
    run({
      kind: 'AddBook', itemId: uuid(n), title, genre: opts.genre ?? null, totalPages: opts.totalPages ?? null,
      startNow: opts.start ?? false, startEventId: uuid(100 + n), localDate: opts.date ?? '2026-09-01',
    });
  const log = (n: number, e: number, type: 'progress' | 'finished' | 'abandoned', date: string, page: number | null = null) =>
    run({ kind: 'LogEvent', itemId: uuid(n), eventId: uuid(200 + e), type, page, localDate: date });
  return { t, run, add, log };
}

const insertArticle = (t: TestDb, n: number, withEvent: boolean) => {
  t.raw.exec({
    sql: `INSERT INTO items (id, type, title, created_at, read_on) VALUES (?, 'article', ?, '2026-09-01T10:00:00.000Z', '2026-09-02')`,
    bind: [uuid(n), `Article ${n}`],
  });
  if (withEvent) {
    t.raw.exec({
      sql: `INSERT INTO reading_events (id, item_id, event_type, page, occurred_at, local_date)
            VALUES (?, ?, 'progress', 10, '2026-09-02T10:00:00.000Z', '2026-09-02')`,
      bind: [uuid(500 + n), uuid(n)],
    });
  }
};

describe('loadStatsBooks', () => {
  it('returns books with genre, totalPages and their non-removed events', () => {
    const { t, add, log } = harness();
    add(1, 'Dune', { start: true, genre: 'Fiction', totalPages: 300 });
    log(1, 1, 'progress', '2026-09-02', 40);
    add(2, 'Queued');
    const books = loadStatsBooks(t.raw);
    expect(books).toHaveLength(2);
    const dune = books.find((b) => b.itemId === uuid(1))!;
    expect(dune.genre).toBe('Fiction');
    expect(dune.totalPages).toBe(300);
    expect(dune.events.map((e) => [e.type, e.page])).toEqual(expect.arrayContaining([['started', null], ['progress', 40]]));
    expect(dune.events).toHaveLength(2);
    const queued = books.find((b) => b.itemId === uuid(2))!;
    expect(queued).toMatchObject({ genre: null, totalPages: null, events: [] });
  });

  it('omits a removed event', () => {
    const { t, add, log, run } = harness();
    add(1, 'Dune', { start: true });
    log(1, 1, 'progress', '2026-09-02', 40);
    run({ kind: 'RemoveEvent', itemId: uuid(1), eventId: uuid(201) });
    const [b] = loadStatsBooks(t.raw);
    expect(b!.events.map((e) => e.type)).toEqual(['started']);
  });

  it('omits a removed book together with all its events', () => {
    const { t, add, log, run } = harness();
    add(1, 'Gone', { start: true });
    log(1, 1, 'progress', '2026-09-02', 40);
    add(2, 'Kept', { start: true });
    run({ kind: 'RemoveBook', itemId: uuid(1) });
    const books = loadStatsBooks(t.raw);
    expect(books.map((b) => b.itemId)).toEqual([uuid(2)]);
  });

  it('never returns articles, with or without events (FR-005, SC-005)', () => {
    const { t, add } = harness();
    add(1, 'Dune', { start: true });
    insertArticle(t, 10, false);
    insertArticle(t, 11, true);
    const books = loadStatsBooks(t.raw);
    expect(books.map((b) => b.itemId)).toEqual([uuid(1)]);
    expect(books.flatMap((b) => b.events).every((e) => e.itemId === uuid(1))).toBe(true);
  });

  it('returns an empty list for an empty database', () => {
    expect(loadStatsBooks(harness().t.raw)).toEqual([]);
  });
});
