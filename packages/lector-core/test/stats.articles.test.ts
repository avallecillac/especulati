import { describe, expect, it } from 'vitest';
import { articleStats, type Article, type Instant, type NormalizedUrl, type WordCount } from '../src/index.ts';
import { day, itemId } from './fixtures.ts';

let n = 0;
const art = (readOn: string, extra: Partial<Article> = {}): Article => {
  n++;
  return {
    id: itemId(n),
    title: `Article ${n}` as Article['title'],
    author: null,
    url: `https://example.com/${n}` as NormalizedUrl,
    domain: 'example.com',
    wordCount: null,
    readOn: day(readOn),
    detailsStatus: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z' as Instant,
    deletedAt: null,
    ...extra,
  };
};
const words = (w: number | null) => w as WordCount | null;

// 2026-09-30 is a Wednesday, so the week runs from Monday 2026-09-28.
const today = day('2026-09-30');

describe('articleStats', () => {
  it('counts this week (Monday start) and this month', () => {
    const list = [
      art('2026-09-28'), art('2026-09-29'), art('2026-09-30'),
      art('2026-09-27'), art('2026-09-20'), art('2026-09-15'), art('2026-09-10'), art('2026-09-01'),
      art('2026-08-31'),
    ];
    const s = articleStats(list, { year: 2026, today });
    expect(s.thisWeek).toBe(3);
    expect(s.thisMonth).toBe(8);
  });

  it('computes minutes over the selected year, ignoring null word counts and other years', () => {
    const list = [
      art('2026-03-01', { wordCount: words(2380) }),
      art('2026-04-01', { wordCount: words(1190) }),
      art('2026-05-01', { wordCount: null }),
      art('2025-05-01', { wordCount: words(50000) }),
    ];
    expect(articleStats(list, { year: 2026, today }).minutes).toBe(15);
    expect(articleStats(list, { year: 2025, today }).minutes).toBe(210);
  });

  it('sorts top sites by count desc then domain asc, at most 5', () => {
    const at = (domain: string, k: number) => Array.from({ length: k }, () => art('2026-02-02', { domain }));
    const list = [...at('z.com', 3), ...at('b.com', 2), ...at('a.com', 2), ...at('c.com', 1), ...at('d.com', 1), ...at('e.com', 1), ...at('f.com', 1)];
    list.push(art('2025-02-02', { domain: 'other.com' }));
    const s = articleStats(list, { year: 2026, today });
    expect(s.topSites).toEqual([
      { domain: 'z.com', count: 3 },
      { domain: 'a.com', count: 2 },
      { domain: 'b.com', count: 2 },
      { domain: 'c.com', count: 1 },
      { domain: 'd.com', count: 1 },
    ]);
  });

  it('has 12 month entries for the selected year', () => {
    const list = [art('2026-01-05'), art('2026-01-06'), art('2026-12-31'), art('2025-06-01')];
    const s = articleStats(list, { year: 2026, today });
    expect(s.months).toHaveLength(12);
    expect(s.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s.months.map((m) => m.count)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('excludes removed articles', () => {
    const list = [art('2026-09-30'), art('2026-09-30', { deletedAt: '2026-09-30T10:00:00.000Z' as Instant, wordCount: words(2380) })];
    const s = articleStats(list, { year: 2026, today });
    expect(s.thisWeek).toBe(1);
    expect(s.thisMonth).toBe(1);
    expect(s.minutes).toBe(0);
    expect(s.months[8]!.count).toBe(1);
    expect(s.topSites).toEqual([{ domain: 'example.com', count: 1 }]);
  });

  it('handles a week spanning a year boundary', () => {
    // Friday 2027-01-01: the week began Monday 2026-12-28.
    const list = [art('2026-12-28'), art('2026-12-31'), art('2027-01-01'), art('2026-12-27')];
    const s = articleStats(list, { year: 2027, today: day('2027-01-01') });
    expect(s.thisWeek).toBe(3);
    expect(s.thisMonth).toBe(1);
  });

  it('ignores articles after today for week and month', () => {
    const s = articleStats([art('2026-09-30'), art('2026-10-01')], { year: 2026, today });
    expect(s.thisWeek).toBe(1);
    expect(s.thisMonth).toBe(1);
  });
});
