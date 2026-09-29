import { eventOrder, type ReadingEvent } from './book.ts';
import type { Genre, ItemId, LocalDate, PageCount } from './types.ts';

/** Days since 1970-01-01 for a calendar date (Hinnant's days-from-civil; integer maths only, research R2). */
export function dayNumber(d: LocalDate): number {
  const y0 = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of `dayNumber` (Hinnant's civil-from-days). */
export function fromDayNumber(n: number): LocalDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` as LocalDate;
}

/** One non-removed book with its non-removed events: the input to every stat. */
export interface StatsBook {
  readonly itemId: ItemId;
  readonly genre: Genre | null;
  readonly totalPages: PageCount | null;
  readonly events: readonly ReadingEvent[];
}

export interface ReadThrough {
  readonly itemId: ItemId;
  readonly start: LocalDate;
  readonly end: LocalDate | null;
  readonly outcome: 'finished' | 'abandoned' | 'open';
  /** The read-through's first event is `started`. */
  readonly began: boolean;
  /** One per page-bearing event, in order; `pages` may be 0. */
  readonly credits: readonly { readonly date: LocalDate; readonly pages: number }[];
  readonly daysToFinish: number | null;
}

/** Split a book's events into read-throughs and credit pages (research R3). */
export function readThroughs(events: readonly ReadingEvent[]): ReadThrough[] {
  const out: ReadThrough[] = [];
  let cur: { itemId: ItemId; start: LocalDate; began: boolean; credits: { date: LocalDate; pages: number }[]; high: number; seenPage: boolean } | null = null;

  for (const e of eventOrder(events)) {
    if (cur === null) {
      cur = { itemId: e.itemId, start: e.localDate, began: e.type === 'started', credits: [], high: 0, seenPage: false };
    }
    if (e.page !== null) {
      if (!cur.seenPage && !cur.began) cur.high = e.page;
      cur.credits.push({ date: e.localDate, pages: Math.max(0, e.page - cur.high) });
      cur.high = Math.max(cur.high, e.page);
      cur.seenPage = true;
    }
    if (e.type === 'finished' || e.type === 'abandoned') {
      out.push({
        itemId: cur.itemId,
        start: cur.start,
        end: e.localDate,
        outcome: e.type,
        began: cur.began,
        credits: cur.credits,
        daysToFinish: e.type === 'finished' ? dayNumber(e.localDate) - dayNumber(cur.start) + 1 : null,
      });
      cur = null;
    }
  }
  if (cur !== null) {
    out.push({ itemId: cur.itemId, start: cur.start, end: null, outcome: 'open', began: cur.began, credits: cur.credits, daysToFinish: null });
  }
  return out;
}

/**
 * Reading days: every date with a started, progress or finished event, mapped to the pages
 * credited that day across all books. A bare `abandoned` never counts (FR-002).
 */
export function readingDays(books: readonly StatsBook[]): Map<LocalDate, number> {
  const days = new Map<LocalDate, number>();
  for (const b of books) {
    for (const e of b.events) {
      if (e.deletedAt === null && e.type !== 'abandoned' && !days.has(e.localDate)) days.set(e.localDate, 0);
    }
    for (const rt of readThroughs(b.events)) {
      for (const c of rt.credits) days.set(c.date, (days.get(c.date) ?? 0) + c.pages);
    }
  }
  return days;
}

/** Heatmap level: 0 not a reading day; 1 no pages; 2 is 1-19; 3 is 20-49; 4 is 50 or more (research R5). */
export function heatLevel(isReadingDay: boolean, pages: number): 0 | 1 | 2 | 3 | 4 {
  if (!isReadingDay) return 0;
  if (pages <= 0) return 1;
  if (pages < 20) return 2;
  if (pages < 50) return 3;
  return 4;
}
