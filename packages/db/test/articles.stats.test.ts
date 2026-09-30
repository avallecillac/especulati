import { describe, expect, it } from 'vitest';
import { articleStats, type Command, type LocalDate } from '@readerlog/core';
import { articleStatsView, loadArticles } from '../src/stats.ts';
import { openTestDb, uuid } from './helpers.ts';

type AddArticle = Extract<Command, { kind: 'AddArticle' }>;

const TODAY = '2026-09-30' as LocalDate;

function seed() {
  const t = openTestDb();
  const add = (n: number, p: Partial<AddArticle>) => {
    t.tick();
    const r = t.db.dispatch(
      { kind: 'AddArticle', itemId: uuid(n), url: `https://www.example.com/a${n}`, title: `Article ${n}`, author: null, wordCount: 1190, readOn: '2026-09-29', detailsStatus: 'complete', ...p },
      t.env,
    );
    expect(r).toMatchObject({ ok: true });
  };
  add(1, { wordCount: 1190 });
  add(2, { url: 'https://blog.example.org/x', wordCount: 2380, readOn: '2026-09-01' });
  add(3, { wordCount: null, readOn: '2026-03-01' });
  add(4, { readOn: '2025-12-31' });
  add(5, { readOn: '2026-09-30' });
  t.tick();
  t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(5) }, t.env);
  t.db.dispatch({ kind: 'AddBook', itemId: uuid(9), title: 'Dune', startNow: true, localDate: '2026-09-30' }, t.env);
  return t;
}

describe('article stats read model', () => {
  it('loadArticles returns live articles only (no books, no removed)', () => {
    const t = seed();
    expect(loadArticles(t.db.raw)).toHaveLength(4);
  });

  it('articleStatsView equals core articleStats over the live articles', () => {
    const t = seed();
    const v = articleStatsView(t.db.raw, 2026, TODAY);
    expect(v).toEqual(articleStats(loadArticles(t.db.raw), { year: 2026, today: TODAY }));
    expect(v.thisWeek).toBe(1);
    expect(v.thisMonth).toBe(2);
    expect(v.months[8]!.count).toBe(2);
    expect(v.minutes).toBe(15);
    expect(v.topSites).toEqual([{ domain: 'example.com', count: 2 }, { domain: 'blog.example.org', count: 1 }]);
    expect(t.db.articleStats(2026, TODAY)).toEqual(v);
  });
});
