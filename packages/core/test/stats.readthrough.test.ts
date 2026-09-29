import { describe, expect, it } from 'vitest';
import { heatLevel, readingDays, readThroughs, type EventType, type Page, type ReadingEvent, type StatsBook } from '../src/index.ts';
import { book, day, event, itemId } from './fixtures.ts';

/** Event on `date` (YYYY-MM-DD); occurredAt follows the date so ordering is by day. */
const ev = (type: EventType, date: string, page: number | null = null, extra: Partial<ReadingEvent> = {}): ReadingEvent =>
  event({
    type,
    page: page as Page | null,
    localDate: day(date),
    occurredAt: `${date}T10:00:00.000Z` as ReadingEvent['occurredAt'],
    ...extra,
  });

const credits = (events: ReadingEvent[], i = 0) => readThroughs(events)[i]!.credits;

describe('readThroughs: page credit (R3)', () => {
  it('started, then pages 40, 90, 150 credit 40, 50, 60', () => {
    const rt = readThroughs([
      ev('started', '2026-03-01'),
      ev('progress', '2026-03-02', 40),
      ev('progress', '2026-03-03', 90),
      ev('progress', '2026-03-04', 150),
    ]);
    expect(rt).toHaveLength(1);
    expect(rt[0]!.began).toBe(true);
    expect(rt[0]!.credits).toEqual([
      { date: '2026-03-02', pages: 40 },
      { date: '2026-03-03', pages: 50 },
      { date: '2026-03-04', pages: 60 },
    ]);
  });

  it('no started: first page 40 credits 0, then 90 credits 50', () => {
    const rt = readThroughs([ev('progress', '2026-03-02', 40), ev('progress', '2026-03-03', 90)]);
    expect(rt[0]!.began).toBe(false);
    expect(rt[0]!.credits).toEqual([
      { date: '2026-03-02', pages: 0 },
      { date: '2026-03-03', pages: 50 },
    ]);
  });

  it('a lower page credits 0 and does not lower the high-water mark', () => {
    const c = credits([
      ev('started', '2026-03-01'),
      ev('progress', '2026-03-02', 120),
      ev('progress', '2026-03-03', 100),
      ev('progress', '2026-03-04', 130),
    ]);
    expect(c.map((x) => x.pages)).toEqual([120, 0, 10]);
  });

  it('page-less progress carries no credit entry', () => {
    const c = credits([ev('started', '2026-03-01'), ev('progress', '2026-03-02'), ev('progress', '2026-03-03', 30)]);
    expect(c).toEqual([{ date: '2026-03-03', pages: 30 }]);
  });

  it('a re-read after finished opens a new began read-through and restarts the high-water mark', () => {
    const rt = readThroughs([
      ev('started', '2026-03-01'),
      ev('progress', '2026-03-02', 200),
      ev('finished', '2026-03-05'),
      ev('started', '2026-04-01'),
      ev('progress', '2026-04-02', 30),
    ]);
    expect(rt).toHaveLength(2);
    expect(rt[0]!.outcome).toBe('finished');
    expect(rt[1]!.began).toBe(true);
    expect(rt[1]!.start).toBe('2026-04-01');
    expect(rt[1]!.credits).toEqual([{ date: '2026-04-02', pages: 30 }]);
  });

  it('abandon then resume with progress page 200 (no started): new read-through, began false, credit 0', () => {
    const rt = readThroughs([
      ev('started', '2026-03-01'),
      ev('progress', '2026-03-02', 100),
      ev('abandoned', '2026-03-03'),
      ev('progress', '2026-04-01', 200),
      ev('progress', '2026-04-02', 230),
    ]);
    expect(rt).toHaveLength(2);
    expect(rt[0]!.outcome).toBe('abandoned');
    expect(rt[1]!.began).toBe(false);
    expect(rt[1]!.credits.map((x) => x.pages)).toEqual([0, 30]);
  });

  it('a backdated event sorting before started opens the read-through, so began is false', () => {
    const rt = readThroughs([
      ev('started', '2026-03-05'),
      ev('progress', '2026-03-01', 40, { occurredAt: '2026-03-06T10:00:00.000Z' as ReadingEvent['occurredAt'] }),
      ev('progress', '2026-03-06', 90),
    ]);
    expect(rt).toHaveLength(1);
    expect(rt[0]!.began).toBe(false);
    expect(rt[0]!.start).toBe('2026-03-01');
    expect(rt[0]!.credits).toEqual([
      { date: '2026-03-01', pages: 0 },
      { date: '2026-03-06', pages: 50 },
    ]);
  });

  it('ignores removed events', () => {
    const rt = readThroughs([
      ev('started', '2026-03-01'),
      ev('progress', '2026-03-02', 500, { deletedAt: '2026-03-03T00:00:00.000Z' as ReadingEvent['deletedAt'] }),
      ev('progress', '2026-03-03', 40),
    ]);
    expect(rt[0]!.credits).toEqual([{ date: '2026-03-03', pages: 40 }]);
    expect(readThroughs([ev('started', '2026-03-01', null, { deletedAt: '2026-03-03T00:00:00.000Z' as ReadingEvent['deletedAt'] })])).toEqual([]);
  });

  it('empty input gives no read-throughs', () => expect(readThroughs([])).toEqual([]));
});

describe('readThroughs: outcome, end, daysToFinish', () => {
  it('finished Mar 1 to Mar 10 has daysToFinish 10 and end Mar 10', () => {
    const [rt] = readThroughs([ev('started', '2026-03-01'), ev('finished', '2026-03-10')]);
    expect(rt).toMatchObject({ itemId: itemId(1), start: '2026-03-01', end: '2026-03-10', outcome: 'finished', daysToFinish: 10 });
  });

  it('finished on its start day has daysToFinish 1', () => {
    const [rt] = readThroughs([ev('started', '2026-03-01'), ev('finished', '2026-03-01', null, { occurredAt: '2026-03-01T18:00:00.000Z' as ReadingEvent['occurredAt'] })]);
    expect(rt!.daysToFinish).toBe(1);
  });

  it('abandoned closes with outcome abandoned and no daysToFinish', () => {
    const [rt] = readThroughs([ev('started', '2026-03-01'), ev('abandoned', '2026-03-04')]);
    expect(rt).toMatchObject({ end: '2026-03-04', outcome: 'abandoned', daysToFinish: null });
  });

  it('an unfinished read-through is open with end null', () => {
    const [rt] = readThroughs([ev('started', '2026-03-01'), ev('progress', '2026-03-02', 10)]);
    expect(rt).toMatchObject({ end: null, outcome: 'open', daysToFinish: null });
  });

  it('input order does not matter', () => {
    const a = ev('started', '2026-03-01');
    const b = ev('progress', '2026-03-02', 40);
    const c = ev('finished', '2026-03-09');
    expect(readThroughs([c, a, b])).toEqual(readThroughs([a, b, c]));
  });
});

const statsBook = (n: number, events: ReadingEvent[]): StatsBook => ({
  itemId: itemId(n),
  genre: null,
  totalPages: book().totalPages,
  events: events.map((e) => ({ ...e, itemId: itemId(n) })),
});

describe('readingDays', () => {
  it('a page-less progress day is a key with 0 pages; started and finished days are keys', () => {
    const days = readingDays([
      statsBook(1, [ev('started', '2026-03-01'), ev('progress', '2026-03-02'), ev('progress', '2026-03-03', 40), ev('finished', '2026-03-04')]),
    ]);
    expect([...days.entries()].sort()).toEqual([
      ['2026-03-01', 0],
      ['2026-03-02', 0],
      ['2026-03-03', 40],
      ['2026-03-04', 0],
    ]);
  });

  it('a bare abandoned day is not a key', () => {
    const days = readingDays([statsBook(1, [ev('started', '2026-03-01'), ev('abandoned', '2026-03-05')])]);
    expect([...days.keys()]).toEqual(['2026-03-01']);
  });

  it('an abandon at a page counts through its companion progress event', () => {
    const t = '2026-03-05T10:00:00.000Z' as ReadingEvent['occurredAt'];
    const days = readingDays([
      statsBook(1, [
        ev('started', '2026-03-01'),
        ev('progress', '2026-03-02', 90),
        ev('abandoned', '2026-03-05', null, { id: 'a' as ReadingEvent['id'], occurredAt: t }),
        ev('progress', '2026-03-05', 120, { id: 'z' as ReadingEvent['id'], occurredAt: t }),
      ]),
    ]);
    expect(days.get(day('2026-03-05'))).toBe(30);
  });

  it('two books on one day sum their pages; several events on one day count once', () => {
    const days = readingDays([
      statsBook(1, [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 40), ev('progress', '2026-03-02', 60, { occurredAt: '2026-03-02T11:00:00.000Z' as ReadingEvent['occurredAt'] })]),
      statsBook(2, [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 25)]),
    ]);
    expect(days.size).toBe(2);
    expect(days.get(day('2026-03-02'))).toBe(60 + 25);
    expect(days.get(day('2026-03-01'))).toBe(0);
  });

  it('ignores removed events', () => {
    const gone = '2026-03-09T00:00:00.000Z' as ReadingEvent['deletedAt'];
    const days = readingDays([statsBook(1, [ev('started', '2026-03-01'), ev('progress', '2026-03-02', 40, { deletedAt: gone })])]);
    expect([...days.keys()]).toEqual(['2026-03-01']);
  });

  it('no books gives an empty map', () => expect(readingDays([]).size).toBe(0));
});

describe('heatLevel', () => {
  it('maps pages to levels', () => {
    expect(heatLevel(false, 0)).toBe(0);
    expect(heatLevel(false, 100)).toBe(0);
    expect(heatLevel(true, 0)).toBe(1);
    expect(heatLevel(true, 1)).toBe(2);
    expect(heatLevel(true, 19)).toBe(2);
    expect(heatLevel(true, 20)).toBe(3);
    expect(heatLevel(true, 49)).toBe(3);
    expect(heatLevel(true, 50)).toBe(4);
    expect(heatLevel(true, 900)).toBe(4);
  });
});
