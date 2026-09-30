import { deriveStatus, eventOrder, lastPage, type ReadingEvent } from './book.ts';
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

export interface MonthStat {
  readonly month: number;
  readonly booksFinished: number;
  readonly pages: number;
}

export interface YearSummary {
  readonly year: number;
  readonly readingDays: number;
  readonly booksFinished: number;
  readonly pages: number;
  /** round(pages / readingDays), or null when there are no reading days. */
  readonly pagesPerReadingDay: number | null;
  /** Mean days to finish of the read-throughs finished in the year, to 1 decimal place; null when none. */
  readonly avgDaysToFinish: number | null;
  /** Always 12 entries, `month` 1..12. */
  readonly months: MonthStat[];
}

export interface AllTimeRow {
  readonly year: number;
  readonly readingDays: number;
  readonly booksFinished: number;
  readonly pages: number;
}

const yearPrefix = (year: number) => `${String(year).padStart(4, '0')}-`;

/** Reading days, books finished and pages for one year, with its monthly breakdown (FR-011, FR-012). */
export function yearSummary(books: readonly StatsBook[], year: number): YearSummary {
  return summarize(readingDays(books), finishDates(books), year, finishSpans(books));
}

/** The `daysToFinish` of every read-through finished in the year (by finish date). */
function finishSpans(books: readonly StatsBook[]): { end: LocalDate; days: number }[] {
  const out: { end: LocalDate; days: number }[] = [];
  for (const b of books) {
    for (const rt of readThroughs(b.events)) {
      if (rt.outcome === 'finished' && rt.end !== null && rt.daysToFinish !== null) out.push({ end: rt.end, days: rt.daysToFinish });
    }
  }
  return out;
}

function finishDates(books: readonly StatsBook[]): LocalDate[] {
  const out: LocalDate[] = [];
  for (const b of books) for (const e of b.events) if (e.deletedAt === null && e.type === 'finished') out.push(e.localDate);
  return out;
}

function summarize(days: ReadonlyMap<LocalDate, number>, finishes: readonly LocalDate[], year: number, spans: readonly { end: LocalDate; days: number }[] = []): YearSummary {
  const prefix = yearPrefix(year);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, booksFinished: 0, pages: 0 }));
  let readingDaysInYear = 0;
  let pages = 0;
  for (const [d, p] of days) {
    if (!d.startsWith(prefix)) continue;
    readingDaysInYear++;
    pages += p;
    months[Number(d.slice(5, 7)) - 1]!.pages += p;
  }
  let booksFinished = 0;
  for (const d of finishes) {
    if (!d.startsWith(prefix)) continue;
    booksFinished++;
    months[Number(d.slice(5, 7)) - 1]!.booksFinished++;
  }
  const inYear = spans.filter((s) => s.end.startsWith(prefix));
  const total = inYear.reduce((a, s) => a + s.days, 0);
  return {
    year,
    readingDays: readingDaysInYear,
    booksFinished,
    pages,
    pagesPerReadingDay: readingDaysInYear === 0 ? null : Math.round(pages / readingDaysInYear),
    avgDaysToFinish: inYear.length === 0 ? null : Math.round((total / inYear.length) * 10) / 10,
    months,
  };
}

export interface AbandonStat {
  /** null is the overall row, or books with no genre (shown as "No genre"). */
  readonly genre: string | null;
  readonly finished: number;
  readonly abandoned: number;
  /** round(100 * abandoned / (finished + abandoned)); 0 when both are 0. */
  readonly rate: number;
}

const abandonStat = (genre: string | null, finished: number, abandoned: number): AbandonStat => ({
  genre,
  finished,
  abandoned,
  rate: finished + abandoned === 0 ? 0 : Math.round((100 * abandoned) / (finished + abandoned)),
});

/** Abandon rate overall and per genre, from each book's current status (FR-017). Genres sort A-Z, "No genre" last. */
export function abandonRates(books: readonly StatsBook[]): { overall: AbandonStat; byGenre: AbandonStat[] } {
  const groups = new Map<string | null, { finished: number; abandoned: number }>();
  let finished = 0;
  let abandoned = 0;
  for (const b of books) {
    const status = deriveStatus(b.events.filter((e) => e.deletedAt === null));
    if (status !== 'finished' && status !== 'abandoned') continue;
    const g = groups.get(b.genre) ?? { finished: 0, abandoned: 0 };
    if (status === 'finished') {
      g.finished++;
      finished++;
    } else {
      g.abandoned++;
      abandoned++;
    }
    groups.set(b.genre, g);
  }
  const byGenre = [...groups]
    .map(([genre, g]) => abandonStat(genre, g.finished, g.abandoned))
    .sort((a, b) => (a.genre === null ? 1 : b.genre === null ? -1 : a.genre < b.genre ? -1 : a.genre > b.genre ? 1 : 0));
  return { overall: abandonStat(null, finished, abandoned), byGenre };
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
  /** One row per year with a reading day or a finish, newest first. */
  readonly allTime: AllTimeRow[];
  readonly heatmap: HeatCell[];
  readonly current: Streak | null;
  readonly longest: Streak | null;
  readonly abandon: { overall: AbandonStat; byGenre: AbandonStat[] };
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
  for (let n = jan1; n < nextJan1; n++) {
    const date = fromDayNumber(n);
    const pages = days.get(date);
    const isDay = pages !== undefined;
    heatmap.push({ date, level: heatLevel(isDay, pages ?? 0), pages: pages ?? 0 });
  }

  const finishes = finishDates(books);
  const spans = finishSpans(books);
  const allTimeYears = new Set<number>(finishes.map(yearOf));
  for (const d of days.keys()) allTimeYears.add(yearOf(d));

  const keys = new Set(days.keys());
  return {
    year,
    years: [...yearSet].sort((a, b) => b - a),
    summary: summarize(days, finishes, year, spans),
    allTime: [...allTimeYears]
      .sort((a, b) => b - a)
      .map((y) => {
        const { readingDays: rd, booksFinished, pages } = summarize(days, finishes, y);
        return { year: y, readingDays: rd, booksFinished, pages };
      }),
    heatmap,
    current: currentStreak(keys, today),
    longest: longestStreak(keys),
    abandon: abandonRates(books),
    hasAnyEvents: books.some((b) => b.events.some((e) => e.deletedAt === null)),
  };
}

export interface Pace {
  /** Rounded to 1 decimal place for display only; the estimate uses the unrounded value. */
  readonly pagesPerDay: number;
  readonly daysLeft: number | null;
  readonly finishDate: LocalDate | null;
}

/** Days in the pace window: today and the 13 days before it (FR-014). */
const PACE_WINDOW = 14;

/**
 * Pace and estimated finish for a book that is being read (research R7); null otherwise.
 * Pure: `today` is a parameter.
 */
export function pace(book: StatsBook, today: LocalDate): Pace | null {
  const live = book.events.filter((e) => e.deletedAt === null);
  if (deriveStatus(live) !== 'reading') return null;
  const rt = readThroughs(live).find((r) => r.outcome === 'open');
  if (!rt) return null;

  const t = dayNumber(today);
  const divisor = Math.max(1, Math.min(PACE_WINDOW, t - dayNumber(rt.start) + 1));
  let pages = 0;
  for (const c of rt.credits) {
    const n = dayNumber(c.date);
    if (n > t - PACE_WINDOW && n <= t) pages += c.pages;
  }
  const pagesPerDay = Math.round((pages / divisor) * 10) / 10;

  const last = lastPage(live);
  if (pages === 0 || book.totalPages === null || last === null || book.totalPages <= last) {
    return { pagesPerDay, daysLeft: null, finishDate: null };
  }
  // ceil(remaining / (pages / divisor)) in integers, so no float error creeps in.
  const daysLeft = Math.ceil(((book.totalPages - last) * divisor) / pages);
  return { pagesPerDay, daysLeft, finishDate: fromDayNumber(t + daysLeft) };
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
/** The only Article fields article stats read, so loaders can skip the rest. */
export type ArticleStatInput = Pick<Article, 'domain' | 'wordCount' | 'readOn' | 'deletedAt'>;

export function articleStats(articles: readonly ArticleStatInput[], opts: { year: number; today: LocalDate }): ArticleStats {
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
