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

/** Feature 007: an article's highlights list stays fast. */
describe('highlights query performance (007 T005)', () => {
  it('highlights(itemId) with 200 rows takes < 20 ms (best of 5)', () => {
    const t = openTestDb();
    t.tick();
    expect(t.db.dispatch({ kind: 'AddArticle', itemId: uuid(1), url: 'https://www.example.com/long', title: 'Long read', author: null, wordCount: 9000, readOn: '2026-09-10', detailsStatus: 'complete' }, t.env).ok).toBe(true);
    for (let i = 0; i < 200; i++) {
      t.tick();
      const r = t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(0x100 + i), itemId: uuid(1), quote: `A passage worth keeping, number ${i}`, note: i % 3 === 0 ? `Note ${i}` : null, localDate: '2026-09-11' }, t.env);
      if (!r.ok) throw new Error(JSON.stringify(r));
    }
    t.db.highlights(uuid(1)); // warm
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      t.db.highlights(uuid(1));
      best = Math.min(best, performance.now() - start);
    }
    console.log(`highlights(itemId) ${best.toFixed(2)} ms over 200 rows`);
    expect(t.db.highlights(uuid(1))).toHaveLength(200);
    expect(best).toBeLessThan(20);
  });
});

/** Feature 008 SC-004 (research R5): search over 5,000 articles and 2,000 highlights. */
describe('article search performance (008 T007)', () => {
  it('a query takes < 100 ms with the index built (best of 5), and < 300 ms the first time including the build', () => {
    const t = openTestDb();
    const raw = t.raw;
    // Bulk-load through SQL (the write path is covered elsewhere): 5,000 articles, 2,000 highlights, 500 tag links.
    raw.exec('BEGIN');
    for (let i = 0; i < 5000; i++) {
      const day = new Date(Date.UTC(2016, 0, 1) + i * 86_400_000 / 2).toISOString();
      raw.exec(
        `INSERT INTO items (id, type, title, author, url, domain, word_count, read_on, metadata_status, created_at)
         VALUES (?, 'article', ?, ?, ?, ?, ?, ?, 'ok', ?)`,
        { bind: [uuid(i + 1), `Article ${i} about subject ${i % 97}`, `Author ${i % 300} Pérez`, `https://site${i % 200}.example/post-${i}`, `site${i % 200}.example`, 1000 + i, i % 10 === 0 ? null : day.slice(0, 10), day] },
      );
    }
    for (let i = 0; i < 2000; i++) {
      raw.exec('INSERT INTO highlights (id, item_id, quote, note, created_at, local_date) VALUES (?, ?, ?, ?, ?, ?)', {
        bind: [uuid(0x100000 + i), uuid((i * 2) + 1), `Quote ${i} with some words about topic${i % 50} and more text to be searched through`, i % 3 === 0 ? `A note ${i}` : null, '2026-09-01T00:00:00.000Z', '2026-09-01'],
      });
    }
    for (let k = 0; k < 40; k++) raw.exec('INSERT INTO tags (id, name, name_key, created_at) VALUES (?, ?, ?, ?)', { bind: [uuid(0x200000 + k), `tag${k}`, `tag${k}`, 'x'] });
    for (let i = 0; i < 500; i++) raw.exec('INSERT INTO item_tags (id, item_id, tag_id, created_at) VALUES (?, ?, ?, ?)', { bind: [uuid(0x300000 + i), uuid(i * 7 + 1), uuid(0x200000 + (i % 40)), 'x'] });
    raw.exec('COMMIT');

    const first = performance.now();
    const hits = t.db.search('subject 42 perez');
    const firstMs = performance.now() - first;
    expect(hits.length).toBeGreaterThan(0);

    const time = (fn: () => unknown) => {
      let best = Infinity;
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        fn();
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const warm = time(() => t.db.search('topic7 words'));
    const tagged = time(() => t.db.search('author', { tagKeys: ['tag3'] }));
    const noMatch = time(() => t.db.search('zzzzqqq'));
    console.log(`search first (with build) ${firstMs.toFixed(1)} ms · warm ${warm.toFixed(1)} ms · tag filter ${tagged.toFixed(1)} ms · no match ${noMatch.toFixed(1)} ms`);
    expect(t.db.search('topic7 words').length).toBeGreaterThan(0);
    expect(firstMs).toBeLessThan(300);
    for (const ms of [warm, tagged, noMatch]) expect(ms).toBeLessThan(100);
  }, 120_000);
});
