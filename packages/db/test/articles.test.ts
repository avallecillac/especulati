import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { openTestDb, uuid, type TestDb } from './helpers.ts';

type AddArticle = Extract<Command, { kind: 'AddArticle' }>;

function addArticle(t: TestDb, n: number, p: Partial<AddArticle> = {}) {
  t.tick();
  const r = t.db.dispatch(
    { kind: 'AddArticle', itemId: uuid(n), url: `https://www.example.com/a${n}`, title: `Article ${n}`, author: null, wordCount: 476, readOn: '2026-09-10', detailsStatus: 'complete', ...p },
    t.env,
  );
  expect(r).toMatchObject({ ok: true });
}

describe('article read model', () => {
  it('articles(): live only, read_on desc then created_at desc, mapped to Article', () => {
    const t = openTestDb();
    addArticle(t, 1, { readOn: '2026-09-10', title: 'Old' });
    addArticle(t, 2, { readOn: '2026-09-12', title: 'Newest day, first added' });
    addArticle(t, 3, { readOn: '2026-09-12', title: 'Newest day, later added', author: 'Ada', wordCount: null, detailsStatus: 'notFound' });
    addArticle(t, 4, { readOn: '2026-09-15', title: 'Removed' });
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(4) }, t.env)).toMatchObject({ ok: true });

    const list = t.db.articles();
    expect(list.map((a) => a.title)).toEqual(['Newest day, later added', 'Newest day, first added', 'Old']);
    expect(list[0]).toMatchObject({
      id: uuid(3),
      author: 'Ada',
      url: 'https://www.example.com/a3',
      domain: 'example.com',
      wordCount: null,
      readOn: '2026-09-12',
      detailsStatus: 'notFound',
      deletedAt: null,
    });
    expect(list[1]).toMatchObject({ author: null, wordCount: 476, detailsStatus: 'complete' });
    expect(typeof list[1]!.createdAt).toBe('string');
  });

  it('articles() pages by keyset: limit, then before = the last row, same order, no gaps or repeats', () => {
    const t = openTestDb();
    // Ties on read_on, and on created_at (no tick between these two), exercise every branch of the cursor.
    for (let i = 1; i <= 7; i++) addArticle(t, i, { readOn: i % 2 ? '2026-09-10' : '2026-09-11' });
    t.tick();
    t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(3) }, t.env);
    const all = t.db.articles({ limit: 100 });
    expect(all).toHaveLength(6);
    const seen: string[] = [];
    let before: { readOn: string; createdAt: string; id: string } | undefined;
    for (;;) {
      const page = t.db.articles({ limit: 4 - (before ? 1 : 0), ...(before ? { before } : {}) });
      seen.push(...page.map((a) => a.id));
      if (page.length < (before ? 3 : 4)) break;
      const last = page[page.length - 1]!;
      before = { readOn: last.readOn, createdAt: last.createdAt, id: last.id };
    }
    expect(seen).toEqual(all.map((a) => a.id));
    expect(t.db.articles({ limit: 2 })).toHaveLength(2);
    expect(t.db.articles()).toHaveLength(6);
  });

  it('articles() ignores books', () => {
    const t = openTestDb();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(9), title: 'Dune', startNow: false, localDate: '2026-09-01' }, t.env);
    expect(t.db.articles()).toEqual([]);
  });

  it('article(id) returns one live article, else null', () => {
    const t = openTestDb();
    addArticle(t, 1);
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(9), title: 'Dune', startNow: false, localDate: '2026-09-01' }, t.env);
    expect(t.db.article(uuid(1))).toMatchObject({ id: uuid(1), title: 'Article 1' });
    expect(t.db.article(uuid(9))).toBeNull();
    expect(t.db.article(uuid(77))).toBeNull();
    t.tick();
    t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(1) }, t.env);
    expect(t.db.article(uuid(1))).toBeNull();
  });

  it('findArticleByUrl returns live matches, newest first', () => {
    const t = openTestDb();
    const url = 'https://example.com/same';
    addArticle(t, 1, { url, readOn: '2026-09-01' });
    addArticle(t, 2, { url: 'https://example.com/other' });
    addArticle(t, 3, { url, readOn: '2026-09-05' });
    addArticle(t, 4, { url, readOn: '2026-09-03' });
    t.tick();
    t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(4) }, t.env);
    expect(t.db.findArticleByUrl(url).map((a) => a.id)).toEqual([uuid(3), uuid(1)]);
    expect(t.db.findArticleByUrl('https://example.com/none')).toEqual([]);
  });

  it('a command on the wrong kind of item is NotFound, and nothing is written', () => {
    const t = openTestDb();
    addArticle(t, 1);
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(9), title: 'Dune', startNow: false, localDate: '2026-09-01' }, t.env);
    const before = t.raw.selectValue('SELECT COUNT(*) FROM change_log');
    expect(t.db.dispatch({ kind: 'RemoveBook', itemId: uuid(1) }, t.env)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(9) }, t.env)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(t.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(before);
  });
});

describe('books-only guards (SC-005)', () => {
  it('home, library, stats and duplicates are unchanged by 100 articles', () => {
    const t = openTestDb();
    const run = (cmd: Command) => { t.tick(); expect(t.db.dispatch(cmd, t.env)).toMatchObject({ ok: true }); };
    run({ kind: 'AddBook', itemId: uuid(1), title: 'Dune', author: 'Frank Herbert', startNow: true, startEventId: uuid(101), localDate: '2026-09-01' });
    run({ kind: 'AddBook', itemId: uuid(2), title: 'Dune', author: 'Frank Herbert', startNow: false, localDate: '2026-09-01' });
    run({ kind: 'AddBook', itemId: uuid(3), title: 'Emma', startNow: true, startEventId: uuid(103), localDate: '2026-09-02' });
    run({ kind: 'LogEvent', itemId: uuid(3), eventId: uuid(203), type: 'finished', localDate: '2026-09-04' });

    const snapshot = () => ({
      home: t.db.home(),
      library: t.db.library(),
      stats: t.db.stats(2026, '2026-09-27' as never),
      duplicates: t.db.duplicates(),
      isbn: t.db.findByIsbn('9780441172719'),
      covers: t.db.missingCovers(),
    });
    const before = snapshot();
    expect(before.duplicates.length).toBe(1);

    for (let i = 0; i < 100; i++)
      addArticle(t, 1000 + i, { title: i % 2 ? 'Dune' : `Essay ${i}`, author: i % 2 ? 'Frank Herbert' : 'Ada', readOn: '2026-09-03', wordCount: 100 * i + 50, url: `https://example.com/p${i}` });

    expect(t.db.articles()).toHaveLength(100);
    expect(snapshot()).toEqual(before);
  });
});
