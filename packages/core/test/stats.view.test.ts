import { describe, expect, it } from 'vitest';
import { abandonRates, computeStats, readingDays, yearSummary, type EventType, type Page, type ReadingEvent, type StatsBook } from '../src/index.ts';
import { day, event, itemId } from './fixtures.ts';
import type { Genre } from '../src/index.ts';

const ev = (type: EventType, date: string, page: number | null = null, extra: Partial<ReadingEvent> = {}): ReadingEvent =>
  event({
    type,
    page: page as Page | null,
    localDate: day(date),
    occurredAt: `${date}T10:00:00.000Z` as ReadingEvent['occurredAt'],
    ...extra,
  });

const sb = (n: number, events: ReadingEvent[]): StatsBook => ({
  itemId: itemId(n),
  genre: null,
  totalPages: null,
  events: events.map((e) => ({ ...e, itemId: itemId(n) })),
});

const TODAY = day('2026-09-29');

/** Deterministic Fisher-Yates with a fixed-seed LCG (no Math.random). */
function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe('computeStats: heatmap', () => {
  it('has 365 entries for 2025 and 366 for 2024, Jan 1 to Dec 31', () => {
    const a = computeStats([], { year: 2025, today: TODAY }).heatmap;
    expect(a).toHaveLength(365);
    expect(a[0]!.date).toBe('2025-01-01');
    expect(a.at(-1)!.date).toBe('2025-12-31');
    const b = computeStats([], { year: 2024, today: TODAY }).heatmap;
    expect(b).toHaveLength(366);
    expect(b[59]!.date).toBe('2024-02-29');
    expect(b.at(-1)!.date).toBe('2024-12-31');
  });

  it('has the right levels and pages on reading days', () => {
    const books = [
      sb(1, [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 10), ev('progress', '2026-03-03', 40), ev('progress', '2026-03-04', 100), ev('progress', '2026-03-05', null)]),
    ];
    const h = computeStats(books, { year: 2026, today: TODAY }).heatmap;
    const at = (d: string) => h.find((c) => c.date === d)!;
    expect(at('2026-03-01')).toEqual({ date: '2026-03-01', level: 1, pages: 0 });
    expect(at('2026-03-02')).toEqual({ date: '2026-03-02', level: 2, pages: 10 });
    expect(at('2026-03-03')).toEqual({ date: '2026-03-03', level: 3, pages: 30 });
    expect(at('2026-03-04')).toEqual({ date: '2026-03-04', level: 4, pages: 60 });
    expect(at('2026-03-05')).toEqual({ date: '2026-03-05', level: 1, pages: 0 });
    expect(at('2026-03-06')).toEqual({ date: '2026-03-06', level: 0, pages: 0 });
  });
});

describe('computeStats: years and summary', () => {
  it('years are descending, with reading-day years plus today year, future included', () => {
    const books = [sb(1, [ev('progress', '2023-05-01'), ev('progress', '2025-01-02'), ev('progress', '2027-02-02')])];
    expect(computeStats(books, { year: 2026, today: TODAY }).years).toEqual([2027, 2026, 2025, 2023]);
  });

  it('with no data years is just the year of today', () => {
    expect(computeStats([], { year: 2026, today: TODAY }).years).toEqual([2026]);
  });

  it('summary.readingDays counts the selected year only', () => {
    const books = [sb(1, [ev('progress', '2025-12-30'), ev('progress', '2025-12-31'), ev('progress', '2026-01-01'), ev('progress', '2026-01-02')])];
    const v25 = computeStats(books, { year: 2025, today: TODAY });
    const v26 = computeStats(books, { year: 2026, today: TODAY });
    expect(v25.summary).toMatchObject({ year: 2025, readingDays: 2 });
    expect(v26.summary).toMatchObject({ year: 2026, readingDays: 2 });
    expect(v26.longest).toEqual({ start: '2025-12-30', end: '2026-01-02', length: 4 });
  });

  it('hasAnyEvents is false for no books or books without events', () => {
    expect(computeStats([], { year: 2026, today: TODAY }).hasAnyEvents).toBe(false);
    expect(computeStats([sb(1, [])], { year: 2026, today: TODAY }).hasAnyEvents).toBe(false);
    expect(computeStats([sb(1, [ev('progress', '2026-01-01')])], { year: 2026, today: TODAY }).hasAnyEvents).toBe(true);
  });

  it('current streak is computed from today', () => {
    const books = [sb(1, [ev('progress', '2026-09-28'), ev('progress', '2026-09-29')])];
    expect(computeStats(books, { year: 2026, today: TODAY }).current).toEqual({ start: '2026-09-28', end: '2026-09-29', length: 2 });
  });
});

describe('computeStats: invariants', () => {
  const books = [
    sb(1, [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 40), ev('progress', '2026-03-03', 90), ev('abandoned', '2026-03-10')]),
    sb(2, [ev('progress', '2026-03-02', 10), ev('progress', '2026-03-04', 60), ev('finished', '2026-03-05'), ev('abandoned', '2026-05-05')]),
    sb(3, [ev('abandoned', '2026-06-06'), ev('started', '2026-09-28'), ev('progress', '2026-09-29', 5)]),
  ];
  const opts = { year: 2026, today: TODAY };

  it('1 determinism: shuffled book and event order gives a deep-equal result', () => {
    const base = computeStats(books, opts);
    for (const seed of [1, 7, 42, 99]) {
      const shuffled = shuffle(books, seed).map((b) => ({ ...b, events: shuffle(b.events, seed + 3) }));
      expect(computeStats(shuffled, opts)).toEqual(base);
    }
  });

  it('2 current <= longest, and the longest run is made of reading days', () => {
    const v = computeStats(books, opts);
    expect(v.current!.length).toBeLessThanOrEqual(v.longest!.length);
    const days = readingDays(books);
    const dates = v.heatmap.filter((c) => c.date >= v.longest!.start && c.date <= v.longest!.end);
    expect(dates).toHaveLength(v.longest!.length);
    for (const c of dates) expect(days.has(day(c.date))).toBe(true);
  });

  it('4 heatmap size is 365 or 366', () => {
    for (const [y, n] of [[2023, 365], [2024, 366], [2026, 365], [2000, 366], [1900, 365]] as const) {
      expect(computeStats(books, { year: y, today: TODAY }).heatmap).toHaveLength(n);
    }
  });

  it('7 a bare abandoned event never creates a reading day', () => {
    const only = [sb(1, [ev('abandoned', '2026-04-04')])];
    const v = computeStats(only, opts);
    expect(v.summary.readingDays).toBe(0);
    expect(v.heatmap.every((c) => c.level === 0)).toBe(true);
    expect(v.current).toBeNull();
    expect(v.longest).toBeNull();
    expect(v.hasAnyEvents).toBe(true);
  });
});

describe('yearSummary and allTime (US2)', () => {
  const opts = { year: 2026, today: TODAY };

  it('counts books finished per month', () => {
    const books = [
      sb(1, [ev('started', '2026-03-01'), ev('finished', '2026-03-05')]),
      sb(2, [ev('started', '2026-03-02'), ev('finished', '2026-03-20')]),
      sb(3, [ev('started', '2026-04-01'), ev('finished', '2026-04-09')]),
    ];
    const s = yearSummary(books, 2026);
    expect(s.months).toHaveLength(12);
    expect(s.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s.months[2]!.booksFinished).toBe(2);
    expect(s.months[3]!.booksFinished).toBe(1);
    expect(s.months[0]!.booksFinished).toBe(0);
    expect(s.booksFinished).toBe(3);
  });

  it('a re-read finished in the same year counts twice', () => {
    const books = [sb(1, [ev('started', '2026-01-01'), ev('finished', '2026-01-10'), ev('started', '2026-02-01'), ev('finished', '2026-02-10')])];
    const s = yearSummary(books, 2026);
    expect(s.booksFinished).toBe(2);
    expect(s.months[0]!.booksFinished).toBe(1);
    expect(s.months[1]!.booksFinished).toBe(1);
  });

  it('pages 40, 90, 150 with started give month pages 150', () => {
    const books = [sb(1, [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 40), ev('progress', '2026-03-03', 90), ev('progress', '2026-03-04', 150)])];
    const s = yearSummary(books, 2026);
    expect(s.months[2]!.pages).toBe(150);
    expect(s.pages).toBe(150);
  });

  it('300 pages over 10 reading days gives 30 pages per reading day', () => {
    const events = [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 100), ev('progress', '2026-03-03', 200), ev('progress', '2026-03-04', 300)];
    for (let d = 5; d <= 10; d++) events.push(ev('progress', `2026-03-${String(d).padStart(2, '0')}`));
    const s = yearSummary([sb(1, events)], 2026);
    expect(s.readingDays).toBe(10);
    expect(s.pages).toBe(300);
    expect(s.pagesPerReadingDay).toBe(30);
  });

  it('pages per reading day is rounded to a whole number, and null with no reading days', () => {
    const books = [sb(1, [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 100), ev('progress', '2026-03-03')])];
    expect(yearSummary(books, 2026).pagesPerReadingDay).toBe(33);
    expect(yearSummary([], 2026).pagesPerReadingDay).toBeNull();
    expect(yearSummary(books, 2025).pagesPerReadingDay).toBeNull();
  });

  it('removed events and removed books do not count (invariant 6)', () => {
    const live = sb(1, [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 100), ev('finished', '2026-03-03')]);
    expect(yearSummary([live], 2026)).toMatchObject({ booksFinished: 1, pages: 100 });
    const withRemovedEvents = sb(1, live.events.map((e) => (e.type === 'finished' || e.page !== null ? { ...e, deletedAt: '2026-03-04T00:00:00.000Z' as ReadingEvent['deletedAt'] } : e)));
    expect(yearSummary([withRemovedEvents], 2026)).toMatchObject({ booksFinished: 0, pages: 0, readingDays: 1 });
    // A removed book is never loaded, so it is simply absent.
    expect(yearSummary([], 2026)).toMatchObject({ booksFinished: 0, pages: 0, readingDays: 0 });
  });

  it('a year boundary: Dec 31 pages go to that year, Jan 1 to the next', () => {
    const books = [sb(1, [ev('started', '2025-12-30'), ev('progress', '2025-12-31', 40), ev('progress', '2026-01-01', 100), ev('finished', '2026-01-01')])];
    const y25 = yearSummary(books, 2025);
    const y26 = yearSummary(books, 2026);
    expect(y25).toMatchObject({ pages: 40, booksFinished: 0, readingDays: 2 });
    expect(y26).toMatchObject({ pages: 60, booksFinished: 1, readingDays: 1 });
    expect(y25.months[11]!.pages).toBe(40);
    expect(y26.months[0]!.pages).toBe(60);
  });

  it('allTime has one row per year with a reading day, newest first, and sums match (invariant 3)', () => {
    const books = [
      sb(1, [ev('started', '2025-12-30'), ev('progress', '2025-12-31', 40), ev('progress', '2026-01-01', 100), ev('finished', '2026-01-02')]),
      sb(2, [ev('started', '2023-05-01'), ev('progress', '2023-05-02', 70)]),
    ];
    const v = computeStats(books, opts);
    expect(v.allTime).toEqual([
      { year: 2026, readingDays: 2, booksFinished: 1, pages: 60 },
      { year: 2025, readingDays: 2, booksFinished: 0, pages: 40 },
      { year: 2023, readingDays: 2, booksFinished: 0, pages: 70 },
    ]);
    const credits = [...readingDays(books).values()].reduce((a, b) => a + b, 0);
    expect(v.allTime.reduce((a, r) => a + r.pages, 0)).toBe(credits);
    expect(v.summary.months.reduce((a, m) => a + m.pages, 0)).toBe(v.summary.pages);
  });

  it('allTime is empty with no reading days', () => {
    expect(computeStats([], opts).allTime).toEqual([]);
  });
});

describe('abandonRates and days to finish (US4)', () => {
  const g = (n: number, genre: string | null, events: ReadingEvent[]): StatsBook => ({ ...sb(n, events), genre: genre as Genre | null });
  const fin = (n: number, genre: string | null) => g(n, genre, [ev('started', '2026-03-01'), ev('finished', '2026-03-05')]);
  const aband = (n: number, genre: string | null) => g(n, genre, [ev('started', '2026-03-01'), ev('abandoned', '2026-03-05')]);

  it('Fiction 25%, No genre 0%, overall 17%', () => {
    const r = abandonRates([fin(1, 'Fiction'), fin(2, 'Fiction'), fin(3, 'Fiction'), aband(4, 'Fiction'), fin(5, null), fin(6, null)]);
    expect(r.overall).toEqual({ genre: null, finished: 5, abandoned: 1, rate: 17 });
    expect(r.byGenre).toEqual([
      { genre: 'Fiction', finished: 3, abandoned: 1, rate: 25 },
      { genre: null, finished: 2, abandoned: 0, rate: 0 },
    ]);
  });

  it('a book abandoned then resumed and finished counts as finished', () => {
    const b = g(1, 'Fiction', [ev('started', '2026-03-01'), ev('abandoned', '2026-03-05'), ev('started', '2026-04-01'), ev('finished', '2026-04-09')]);
    expect(abandonRates([b]).byGenre).toEqual([{ genre: 'Fiction', finished: 1, abandoned: 0, rate: 0 }]);
  });

  it('reading and queued books are not counted, and a genre with only those is not listed', () => {
    const r = abandonRates([g(1, 'Poetry', [ev('started', '2026-03-01')]), g(2, 'Poetry', []), fin(3, 'Fiction')]);
    expect(r.byGenre.map((x) => x.genre)).toEqual(['Fiction']);
    expect(r.overall).toEqual({ genre: null, finished: 1, abandoned: 0, rate: 0 });
  });

  it('removed events are excluded; with no books the overall rate is 0', () => {
    const b = g(1, 'Fiction', [ev('started', '2026-03-01'), ev('abandoned', '2026-03-05', null, { deletedAt: '2026-03-06T00:00:00.000Z' as ReadingEvent['deletedAt'] })]);
    expect(abandonRates([b]).byGenre).toEqual([]);
    expect(abandonRates([])).toEqual({ overall: { genre: null, finished: 0, abandoned: 0, rate: 0 }, byGenre: [] });
  });

  it('computeStats exposes abandon, and is order independent', () => {
    const books = [fin(1, 'Fiction'), aband(2, 'Fiction'), fin(3, null)];
    const v = computeStats(books, { year: 2026, today: TODAY });
    expect(v.abandon).toEqual(abandonRates(books));
    expect(computeStats(shuffle(books, 5), { year: 2026, today: TODAY }).abandon).toEqual(v.abandon);
  });

  it('summary.avgDaysToFinish averages the read-throughs finished in the year', () => {
    const books = [
      sb(1, [ev('started', '2026-03-01'), ev('finished', '2026-03-10')]),
      sb(2, [ev('started', '2026-04-01'), ev('finished', '2026-04-01')]),
      sb(3, [ev('started', '2025-01-01'), ev('finished', '2025-01-30')]),
    ];
    expect(yearSummary(books, 2026).avgDaysToFinish).toBe(5.5);
    expect(yearSummary(books, 2024).avgDaysToFinish).toBeNull();
    expect(yearSummary([], 2026).avgDaysToFinish).toBeNull();
  });

  it('abandon at a page: page 120 after 90 makes today a reading day with 30 pages', () => {
    const events = [ev('started', '2026-09-01'), ev('progress', '2026-09-02', 90), ev('progress', '2026-09-29', 120), ev('abandoned', '2026-09-29')];
    const days = readingDays([sb(1, events)]);
    expect(days.get(day('2026-09-29'))).toBe(30);
  });

  it('a bare abandon with nothing else that day is not a reading day', () => {
    const events = [ev('started', '2026-09-01'), ev('progress', '2026-09-02', 90), ev('abandoned', '2026-09-29')];
    expect(readingDays([sb(1, events)]).has(day('2026-09-29'))).toBe(false);
  });
});
