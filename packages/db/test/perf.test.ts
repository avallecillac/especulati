import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { openTestDb, uuid } from './helpers.ts';

/** Constitution: measure before optimizing. A decade of heavy reading: 100 books, 5,000 events. */
describe('query performance at scale (SC-002 / T066)', () => {
  it('home, library and book queries each stay well under 100 ms', () => {
    const t = openTestDb();
    const run = (cmd: Command) => { t.tick(60_000); if (!t.db.dispatch(cmd, t.env).ok) throw new Error(JSON.stringify(cmd)); };
    let ev = 0;
    for (let b = 0; b < 100; b++) {
      run({ kind: 'AddBook', itemId: uuid(b + 1), title: `Book ${b}`, totalPages: 5000, startNow: true, startEventId: uuid(1_000_000 + b), localDate: '2016-01-01' });
      for (let i = 0; i < 49; i++) {
        const day = new Date(Date.UTC(2016, 0, 1) + (b * 49 + i) * 86_400_000).toISOString().slice(0, 10);
        run({ kind: 'LogEvent', itemId: uuid(b + 1), eventId: uuid(2_000_000 + ev++), type: 'progress', page: (i + 1) * 100, localDate: day });
      }
    }
    expect(t.raw.selectValue('SELECT count(*) FROM reading_events')).toBe(5000);

    const time = (fn: () => unknown) => {
      fn(); // warm
      const start = performance.now();
      fn();
      return performance.now() - start;
    };
    const home = time(() => t.db.home());
    const library = time(() => t.db.library());
    const book = time(() => t.db.book(uuid(50)));
    const dispatch = time(() => run({ kind: 'LogEvent', itemId: uuid(1), eventId: uuid(9_000_000 + ev++), type: 'progress', page: null, localDate: '2026-09-27' }));
    console.log(`home ${home.toFixed(1)} ms · library ${library.toFixed(1)} ms · book ${book.toFixed(1)} ms · dispatch ${dispatch.toFixed(1)} ms`);
    for (const ms of [home, library, book, dispatch]) expect(ms).toBeLessThan(100);
  }, 60_000);
});
