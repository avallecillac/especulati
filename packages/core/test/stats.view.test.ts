import { describe, expect, it } from 'vitest';
import { computeStats, readingDays, type EventType, type Page, type ReadingEvent, type StatsBook } from '../src/index.ts';
import { day, event, itemId } from './fixtures.ts';

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
    expect(v25.summary).toEqual({ year: 2025, readingDays: 2 });
    expect(v26.summary).toEqual({ year: 2026, readingDays: 2 });
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
