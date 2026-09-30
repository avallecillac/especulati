import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { openTestDb, TODAY, uuid } from './helpers.ts';
import { loadArticles } from '../src/stats.ts';

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

    // Best of 5 after a warm-up: the full suite runs files in parallel, so a single sample is noisy.
    const time = (fn: () => unknown) => {
      fn(); // warm
      let best = Infinity;
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        fn();
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const home = time(() => t.db.home());
    const library = time(() => t.db.library());
    const book = time(() => t.db.book(uuid(50), TODAY));
    const dispatch = time(() => run({ kind: 'LogEvent', itemId: uuid(1), eventId: uuid(9_000_000 + ev++), type: 'progress', page: null, localDate: '2026-09-27' }));
    console.log(`home ${home.toFixed(1)} ms · library ${library.toFixed(1)} ms · book ${book.toFixed(1)} ms · dispatch ${dispatch.toFixed(1)} ms`);
    for (const ms of [home, library, book, dispatch]) expect(ms).toBeLessThan(100);
  }, 60_000);
});

/** Feature 005: the Articles list and the duplicate check stay fast with 5,000 articles. */
describe('article query performance (005 T024)', () => {
  it('first articles() page < 20 ms, loadArticles < 100 ms, findArticleByUrl < 5 ms at 5,000 articles (R10b)', () => {
    const t = openTestDb();
    for (let i = 0; i < 5000; i++) {
      t.tick(60_000);
      const day = new Date(Date.UTC(2016, 0, 1) + i * 86_400_000 / 2).toISOString().slice(0, 10);
      const r = t.db.dispatch({ kind: 'AddArticle', itemId: uuid(i + 1), url: `https://site${i % 200}.example/post-${i}`, title: `Article ${i}`, author: 'Some Author', wordCount: 1000 + i, readOn: day, detailsStatus: 'complete' }, t.env);
      if (!r.ok) throw new Error(JSON.stringify(r));
    }
    expect(t.raw.selectValue("SELECT count(*) FROM items WHERE type = 'article'")).toBe(5000);

    // Best of 5 after a warm-up: the full suite runs files in parallel, so a single sample is noisy.
    const time = (fn: () => unknown) => {
      fn(); // warm
      let best = Infinity;
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        fn();
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const page = time(() => t.db.articles());
    const all = time(() => loadArticles(t.raw));
    const find = time(() => t.db.findArticleByUrl('https://site42.example/post-4242'));
    console.log(`articles page ${page.toFixed(1)} ms · loadArticles ${all.toFixed(1)} ms · findArticleByUrl ${find.toFixed(1)} ms`);
    expect(t.db.articles()).toHaveLength(100);
    expect(loadArticles(t.raw)).toHaveLength(5000);
    expect(t.db.findArticleByUrl('https://site42.example/post-4242')).toHaveLength(1);
    expect(page).toBeLessThan(20);
    expect(all).toBeLessThan(100);
    expect(find).toBeLessThan(5);
  }, 120_000);
});


/** Feature 003 SC-001 (research R8): the Stats screen query over a synthetic ten-year history. */
describe('stats query performance (003 T025)', () => {
  it('stats(2026) over 400 books, about 10,000 events and 3,650 reading days takes < 100 ms warm', () => {
    const t = openTestDb();
    const run = (cmd: Command) => { t.tick(60_000); if (!t.db.dispatch(cmd, t.env).ok) throw new Error(JSON.stringify(cmd)); };
    const dayOf = (n: number) => new Date(Date.UTC(2017, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
    let ev = 0;
    for (let b = 0; b < 400; b++) {
      run({ kind: 'AddBook', itemId: uuid(b + 1), title: `Book ${b}`, totalPages: 600, genre: `Genre ${b % 7}`, startNow: true, startEventId: uuid(1_000_000 + b), localDate: dayOf((b * 25) % 3650) });
      for (let i = 1; i < 25; i++) {
        run({ kind: 'LogEvent', itemId: uuid(b + 1), eventId: uuid(2_000_000 + ev++), type: 'progress', page: i * 20, localDate: dayOf((b * 25 + i) % 3650) });
      }
    }
    expect(t.raw.selectValue('SELECT count(*) FROM reading_events')).toBe(10_000);
    expect(t.raw.selectValue('SELECT count(DISTINCT local_date) FROM reading_events')).toBe(3650);

    t.db.stats(2026, '2026-09-29' as never); // warm
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      t.db.stats(2026, '2026-09-29' as never);
      best = Math.min(best, performance.now() - start);
    }
    console.log(`stats(2026) ${best.toFixed(1)} ms over 400 books / 10,000 events`);
    expect(best).toBeLessThan(100);
  }, 180_000);
});
