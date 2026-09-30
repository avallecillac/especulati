import { eventOrder, type ReadingEvent } from './book.ts';
import { WORDS_PER_MINUTE, type Article } from './article.ts';
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
  /** A `started` event comes before the read-through's first page (or, with no page, exists at all). */
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
      cur = { itemId: e.itemId, start: e.localDate, began: false, credits: [], high: 0, seenPage: false };
    }
    // Only a start logged before the first page makes that page count from 0 (FR-006).
    if (e.type === 'started' && !cur.seenPage) cur.began = true;
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

export interface Streak {
  readonly start: LocalDate;
  readonly end: LocalDate;
  readonly length: number;
}

/** Runs of consecutive day numbers in ascending order. */
function runs(nums: readonly number[]): Streak[] {
  const out: Streak[] = [];
  let start = 0;
  for (let i = 1; i <= nums.length; i++) {
    if (i === nums.length || nums[i]! !== nums[i - 1]! + 1) {
      out.push({ start: fromDayNumber(nums[start]!), end: fromDayNumber(nums[i - 1]!), length: i - start });
      start = i;
    }
  }
  return out;
}

const sortedNums = (days: ReadonlySet<LocalDate>): number[] => [...days].map(dayNumber).sort((a, b) => a - b);

/**
 * Run ending today if today is a reading day, else ending yesterday; `null` if neither is.
 * Days after `today` are ignored (research R6).
 */
export function currentStreak(days: ReadonlySet<LocalDate>, today: LocalDate): Streak | null {
  const t = dayNumber(today);
  const nums = sortedNums(days).filter((n) => n <= t);
  const last = nums.at(-1);
  if (last === undefined || last < t - 1) return null;
  return runs(nums).at(-1) ?? null;
}

/** Longest run over all days; on a tie the most recent run wins. */
export function longestStreak(days: ReadonlySet<LocalDate>): Streak | null {
  let best: Streak | null = null;
  for (const r of runs(sortedNums(days))) {
    if (best === null || r.length >= best.length) best = r;
  }
  return best;
}

export interface YearSummary {
  readonly year: number;
  readonly readingDays: number;
}

export interface HeatCell {
  readonly date: string;
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly pages: number;
}

export interface StatsView {
  readonly year: number;
  /** Years with at least one reading day, plus today's year; descending. */
  readonly years: number[];
  readonly summary: YearSummary;
  readonly heatmap: HeatCell[];
  readonly current: Streak | null;
  readonly longest: Streak | null;
  readonly hasAnyEvents: boolean;
}

/** Everything the Stats screen shows, from books only. Pure: `today` is a parameter. */
export function computeStats(books: readonly StatsBook[], opts: { year: number; today: LocalDate }): StatsView {
  const { year, today } = opts;
  const days = readingDays(books);
  const yearOf = (d: LocalDate) => Number(d.slice(0, 4));

  const yearSet = new Set<number>([yearOf(today)]);
  for (const d of days.keys()) yearSet.add(yearOf(d));

  const jan1 = dayNumber(`${String(year).padStart(4, '0')}-01-01` as LocalDate);
  const nextJan1 = dayNumber(`${String(year + 1).padStart(4, '0')}-01-01` as LocalDate);
  const heatmap: HeatCell[] = [];
  let readingDaysInYear = 0;
  for (let n = jan1; n < nextJan1; n++) {
    const date = fromDayNumber(n);
    const pages = days.get(date);
    const isDay = pages !== undefined;
    if (isDay) readingDaysInYear++;
    heatmap.push({ date, level: heatLevel(isDay, pages ?? 0), pages: pages ?? 0 });
  }

  const keys = new Set(days.keys());
  return {
    year,
    years: [...yearSet].sort((a, b) => b - a),
    summary: { year, readingDays: readingDaysInYear },
    heatmap,
    current: currentStreak(keys, today),
    longest: longestStreak(keys),
    hasAnyEvents: books.some((b) => b.events.some((e) => e.deletedAt === null)),
  };
}

export interface ArticleStats {
  readonly thisWeek: number;
  readonly thisMonth: number;
  /** Twelve entries, `month` 1..12, for the selected year. */
  readonly months: { readonly month: number; readonly count: number }[];
  /** round(sum(word_count) / 238) over the selected year; null word counts are ignored. */
  readonly minutes: number;
  readonly topSites: { readonly domain: string; readonly count: number }[];
}


/** Article stats (data-model "Derived: ArticleStats"). Pure: `today` is a parameter; the week starts on Monday. */
export function articleStats(articles: readonly Article[], opts: { year: number; today: LocalDate }): ArticleStats {
  const { year, today } = opts;
  const t = dayNumber(today);
  // Day 0 (1970-01-01) was a Thursday, so (n + 3) % 7 is 0 on Mondays.
  const weekStart = t - (((t + 3) % 7) + 7) % 7;
  const monthPrefix = today.slice(0, 7);
  const yearPrefix = `${String(year).padStart(4, '0')}-`;

  let thisWeek = 0;
  let thisMonth = 0;
  let words = 0;
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }));
  const sites = new Map<string, number>();
  for (const a of articles) {
    if (a.deletedAt !== null) continue;
    const n = dayNumber(a.readOn);
    if (n >= weekStart && n <= t) thisWeek++;
    if (a.readOn.startsWith(monthPrefix) && n <= t) thisMonth++;
    if (!a.readOn.startsWith(yearPrefix)) continue;
    months[Number(a.readOn.slice(5, 7)) - 1]!.count++;
    words += a.wordCount ?? 0;
    sites.set(a.domain, (sites.get(a.domain) ?? 0) + 1);
  }
  const topSites = [...sites]
    .map(([domain, count]) => ({ domain, count }))
    .sort((x, y) => y.count - x.count || (x.domain < y.domain ? -1 : x.domain > y.domain ? 1 : 0))
    .slice(0, 5);
  return { thisWeek, thisMonth, months, minutes: Math.round(words / WORDS_PER_MINUTE), topSites };
}
