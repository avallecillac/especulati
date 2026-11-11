import { describe, expect, it } from 'vitest';
import { dayNumber, fromDayNumber, pace, type EventType, type Page, type PageCount, type ReadingEvent, type StatsBook } from '../src/index.ts';
import { day, event, itemId } from './fixtures.ts';

const TODAY = day('2026-09-29');
const T = dayNumber(TODAY);
/** The date `n` days before today (negative n: after). */
const ago = (n: number) => fromDayNumber(T - n);

const ev = (type: EventType, daysAgo: number, page: number | null = null): ReadingEvent =>
  event({
    type,
    page: page as Page | null,
    localDate: ago(daysAgo),
    occurredAt: `${ago(daysAgo)}T10:00:00.000Z` as ReadingEvent['occurredAt'],
  });

const sb = (events: ReadingEvent[], totalPages: number | null = 300): StatsBook => ({
  itemId: itemId(1),
  genre: null,
  totalPages: totalPages as PageCount | null,
  events,
});

describe('pace (research R7)', () => {
  it('the spec example: 140 pages in the last 14 days, last page 160 of 300', () => {
    const book = sb([ev('started', 20), ev('progress', 14, 20), ev('progress', 5, 160)]);
    expect(pace(book, TODAY)).toEqual({ pagesPerDay: 10, daysLeft: 14, finishDate: ago(-14) });
  });

  it('a read-through started 4 days ago (both ends) divides by 4', () => {
    const book = sb([ev('started', 3), ev('progress', 1, 40)]);
    expect(pace(book, TODAY)).toMatchObject({ pagesPerDay: 10, daysLeft: 26, finishDate: ago(-26) });
  });

  it('credits older than 13 days before today are excluded; 13 days ago is included', () => {
    const out = sb([ev('started', 30), ev('progress', 14, 50), ev('progress', 13, 80)]);
    // Only the 30 pages credited 13 days ago are in the window: 30 / 14.
    expect(pace(out, TODAY)!.pagesPerDay).toBe(2.1);
  });

  it('credits from the previous read-through are excluded', () => {
    const book = sb([
      ev('started', 12), ev('progress', 11, 100), ev('finished', 10),
      ev('started', 3), ev('progress', 2, 10),
    ]);
    // New read-through started 3 days ago: 4-day divisor, 10 pages.
    expect(pace(book, TODAY)).toMatchObject({ pagesPerDay: 2.5 });
  });

  it('no totalPages or no lastPage: pace stays, the estimate is null', () => {
    expect(pace(sb([ev('started', 3), ev('progress', 1, 40)], null), TODAY)).toEqual({ pagesPerDay: 10, daysLeft: null, finishDate: null });
    expect(pace(sb([ev('started', 3), ev('progress', 1)]), TODAY)).toEqual({ pagesPerDay: 0, daysLeft: null, finishDate: null });
  });

  it('no credits in the window gives pace 0 and no estimate', () => {
    const book = sb([ev('started', 30), ev('progress', 20, 100)]);
    expect(pace(book, TODAY)).toEqual({ pagesPerDay: 0, daysLeft: null, finishDate: null });
  });

  it('lastPage equal to totalPages gives no estimate', () => {
    const book = sb([ev('started', 3), ev('progress', 1, 300)], 300);
    expect(pace(book, TODAY)).toMatchObject({ daysLeft: null, finishDate: null });
    expect(pace(book, TODAY)!.pagesPerDay).toBeGreaterThan(0);
  });

  it('finished, abandoned and queued books give null', () => {
    expect(pace(sb([ev('started', 3), ev('progress', 2, 50), ev('finished', 1)]), TODAY)).toBeNull();
    expect(pace(sb([ev('started', 3), ev('progress', 2, 50), ev('abandoned', 1)]), TODAY)).toBeNull();
    expect(pace(sb([]), TODAY)).toBeNull();
  });

  it('daysLeft is rounded up, using the unrounded pace', () => {
    // 7 pages over a 3-day divisor is 2.33/day; 293 left / 2.33 = 125.6 -> 126. A rounded 2.3 would give 128.
    const book = sb([ev('started', 2), ev('progress', 1, 7)]);
    const p = pace(book, TODAY)!;
    expect(p.pagesPerDay).toBe(2.3);
    expect(p.daysLeft).toBe(126);
    expect(p.finishDate).toBe(ago(-126));
  });

  it('a read-through picked up part-way (no started) credits nothing for its first page', () => {
    const book = sb([ev('progress', 5, 100), ev('progress', 1, 130)]);
    // Start is 5 days ago (divisor 6, both ends), 30 credited pages: 5/day, 170 left.
    expect(pace(book, TODAY)).toMatchObject({ pagesPerDay: 5, daysLeft: 34 });
  });
});
