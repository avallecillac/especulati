import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { articleStatsView, loadArticles } from '../src/index.ts';
import { openTestDb, TODAY, uuid, type TestDb } from './helpers.ts';

type AddArticle = Extract<Command, { kind: 'AddArticle' }>;

function add(t: TestDb, n: number, p: Partial<AddArticle> = {}) {
  t.tick();
  const r = t.db.dispatch(
    { kind: 'AddArticle', itemId: uuid(n), url: `https://www.example.com/a${n}`, title: `Article ${n}`, author: null, wordCount: 476, detailsStatus: 'complete', ...p },
    t.env,
  );
  expect(r).toMatchObject({ ok: true });
}
const save = (t: TestDb, n: number, p: Partial<AddArticle> = {}) => add(t, n, p); // no readOn: saved
const read = (t: TestDb, n: number, p: Partial<AddArticle> = {}) => add(t, n, { readOn: '2026-09-10', ...p });

describe('saved articles (008 S-1)', () => {
  it('articles(), loadArticles, articleStats and findArticleByUrl exclude saved articles', () => {
    const t = openTestDb();
    read(t, 1);
    save(t, 2);
    save(t, 3, { url: 'https://www.example.com/a1' }); // same URL as the read one
    expect(t.raw.selectValue("SELECT count(*) FROM items WHERE type='article' AND read_on IS NULL")).toBe(2);
    expect(t.db.articles().map((a) => a.id)).toEqual([uuid(1)]);
    expect(loadArticles(t.raw)).toHaveLength(1);
    expect(articleStatsView(t.raw, 2026, TODAY).months.reduce((a, m) => a + m.count, 0)).toBe(1);
    expect(t.db.findArticleByUrl('https://www.example.com/a1').map((a) => a.id)).toEqual([uuid(1)]);
    expect(t.db.findArticleByUrl('https://www.example.com/a2')).toEqual([]);
    expect(t.db.article(uuid(2))).toBeNull(); // the read-article lookup
  });

  it('articles() keyset paging never returns a saved article', () => {
    const t = openTestDb();
    for (let i = 1; i <= 5; i++) read(t, i, { readOn: `2026-09-0${i}` });
    for (let i = 6; i <= 9; i++) save(t, i);
    const first = t.db.articles({ limit: 3 });
    const last = first[2]!;
    const rest = t.db.articles({ limit: 3, before: { readOn: last.readOn, createdAt: last.createdAt, id: last.id } });
    expect([...first, ...rest].map((a) => a.id)).toEqual([uuid(5), uuid(4), uuid(3), uuid(2), uuid(1)]);
  });

  it('savedArticles() is newest first (created_at desc, then id), live only, and savedCount() agrees', () => {
    const t = openTestDb();
    save(t, 1, { title: 'Oldest' });
    read(t, 2);
    save(t, 3, { title: 'Middle' });
    save(t, 4, { title: 'Newest' });
    save(t, 5, { title: 'Removed' });
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(5) }, t.env)).toMatchObject({ ok: true });
    const list = t.db.savedArticles();
    expect(list.map((a) => a.title)).toEqual(['Newest', 'Middle', 'Oldest']);
    expect(list[0]).toMatchObject({ id: uuid(4), readOn: null, domain: 'example.com', url: 'https://www.example.com/a4', deletedAt: null });
    expect(t.db.savedCount()).toBe(3);
    expect(t.db.savedArticles({ limit: 2 })).toHaveLength(2);
  });

  it('savedArticle(id) returns a live saved article, else null', () => {
    const t = openTestDb();
    save(t, 1);
    read(t, 2);
    expect(t.db.savedArticle(uuid(1))).toMatchObject({ id: uuid(1), readOn: null });
    expect(t.db.savedArticle(uuid(2))).toBeNull();
    expect(t.db.savedArticle(uuid(9))).toBeNull();
  });

  it('findSavedByUrl returns the live saved articles with that address, oldest first', () => {
    const t = openTestDb();
    save(t, 1, { url: 'https://www.example.com/same' });
    save(t, 2, { url: 'https://www.example.com/same' });
    read(t, 3, { url: 'https://www.example.com/same' });
    save(t, 4, { url: 'https://www.example.com/other' });
    expect(t.db.findSavedByUrl('https://www.example.com/same').map((a) => a.id)).toEqual([uuid(1), uuid(2)]);
    expect(t.db.findSavedByUrl('https://www.example.com/none')).toEqual([]);
  });

  it('marking read moves an article from Saved to Articles; marking unread moves it back', () => {
    const t = openTestDb();
    save(t, 1);
    t.tick();
    expect(t.db.dispatch({ kind: 'MarkArticleRead', itemId: uuid(1), readOn: '2026-09-20' }, t.env)).toMatchObject({ ok: true });
    expect(t.db.savedArticles()).toEqual([]);
    expect(t.db.articles().map((a) => a.id)).toEqual([uuid(1)]);
    expect(t.db.articles()[0]!.readOn).toBe('2026-09-20');
    t.tick();
    expect(t.db.dispatch({ kind: 'MarkArticleUnread', itemId: uuid(1) }, t.env)).toMatchObject({ ok: true });
    expect(t.db.articles()).toEqual([]);
    expect(t.db.savedArticles().map((a) => a.id)).toEqual([uuid(1)]);
  });

  it('SC-003: stats, home, library and duplicates are deep-equal with and without 100 saved articles', () => {
    const t = openTestDb();
    const run = (cmd: Command) => { t.tick(); expect(t.db.dispatch(cmd, t.env)).toMatchObject({ ok: true }); };
    run({ kind: 'AddBook', itemId: uuid(1), title: 'Dune', author: 'Frank Herbert', startNow: true, startEventId: uuid(101), localDate: '2026-09-01' });
    run({ kind: 'AddBook', itemId: uuid(2), title: 'Emma', startNow: true, startEventId: uuid(102), localDate: '2026-09-02' });
    run({ kind: 'LogEvent', itemId: uuid(2), eventId: uuid(202), type: 'finished', localDate: '2026-09-04' });
    for (let i = 0; i < 5; i++) read(t, 100 + i, { readOn: `2026-09-0${i + 1}`, wordCount: 1000 * (i + 1), url: `https://site${i}.example/p` });
    const snapshot = () => ({
      home: t.db.home(),
      library: t.db.library(),
      stats: t.db.stats(2026, TODAY),
      articleStats: t.db.articleStats(2026, TODAY),
      articles: t.db.articles(),
      duplicates: t.db.duplicates(),
    });
    const before = snapshot();
    for (let i = 0; i < 100; i++) save(t, 1000 + i, { title: i % 2 ? 'Dune' : `Essay ${i}`, author: i % 2 ? 'Frank Herbert' : 'Ada', wordCount: 100 * i + 50, url: `https://example.com/p${i}` });
    expect(t.db.savedArticles({ limit: 500 })).toHaveLength(100);
    expect(snapshot()).toEqual(before);
  });
});
