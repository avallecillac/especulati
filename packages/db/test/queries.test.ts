import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { openTestDb, TODAY, uuid, type TestDb } from './helpers.ts';

function seed(t: TestDb) {
  const run = (cmd: Command) => { t.tick(); const r = t.db.dispatch(cmd, t.env); expect(r).toMatchObject({ ok: true }); };
  const add = (n: number, title: string, start: boolean, date = '2026-09-01') =>
    run({ kind: 'AddBook', itemId: uuid(n), title, startNow: start, startEventId: uuid(100 + n), localDate: date });
  const log = (n: number, e: number, type: 'progress' | 'finished' | 'abandoned', date: string, page: number | null = null) =>
    run({ kind: 'LogEvent', itemId: uuid(n), eventId: uuid(200 + e), type, page, localDate: date });

  add(1, 'Reading old', true, '2026-09-01');
  add(2, 'Reading recent', true, '2026-09-05');
  add(3, 'Queued', false);
  add(4, 'Finished', true);
  log(4, 1, 'finished', '2026-09-03');
  add(5, 'Abandoned', true);
  log(5, 2, 'abandoned', '2026-09-04');
  add(6, 'Removed', true);
  run({ kind: 'RemoveBook', itemId: uuid(6) });
  log(1, 3, 'progress', '2026-09-02', 40);
  log(1, 4, 'progress', '2026-09-03', 55);
  return run;
}

describe('library query (FR-015, FR-016)', () => {
  it('lists every non-removed book exactly once, grouped by derived status', () => {
    const t = openTestDb();
    seed(t);
    const lib = t.db.library();
    const titles = (g: keyof typeof lib) => lib[g].map((c) => c.title);
    expect(titles('reading')).toEqual(['Reading recent', 'Reading old']);
    expect(titles('queued')).toEqual(['Queued']);
    expect(titles('finished')).toEqual(['Finished']);
    expect(titles('abandoned')).toEqual(['Abandoned']);
    const all = [...lib.reading, ...lib.queued, ...lib.finished, ...lib.abandoned].map((c) => c.itemId);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain(uuid(6));
  });
});

describe('book query', () => {
  it('returns the card and non-deleted events, newest first', () => {
    const t = openTestDb();
    seed(t);
    const view = t.db.book(uuid(1), TODAY)!;
    expect(view.card).toMatchObject({ title: 'Reading old', status: 'reading', lastPage: 55 });
    expect(view.events.map((e) => [e.localDate, e.type, e.page])).toEqual([
      ['2026-09-03', 'progress', 55],
      ['2026-09-02', 'progress', 40],
      ['2026-09-01', 'started', null],
    ]);
  });

  it('returns pace for a reading book and null for a finished one', () => {
    const t = openTestDb();
    seed(t);
    // Book 1 started Sep 1, credited 40 + 15 pages by Sep 3: 55 pages over a 3-day divisor. No total pages: no estimate.
    expect(t.db.book(uuid(1), '2026-09-03' as typeof TODAY)!.pace).toEqual({ pagesPerDay: 18.3, daysLeft: null, finishDate: null });
    expect(t.db.book(uuid(4), TODAY)!.pace).toBeNull();
    expect(t.db.book(uuid(3), TODAY)!.pace).toBeNull();
  });

  it('removed books are absent from every view', () => {
    const t = openTestDb();
    seed(t);
    expect(t.db.book(uuid(6), TODAY)).toBeNull();
    expect(t.db.home().otherReading.map((c) => c.itemId)).not.toContain(uuid(6));
  });
});
