# Contract: Stats (core functions, db query, worker message)

## Core (`packages/core/src/stats.ts`, pure)

```ts
interface StatsBook { itemId: ItemId; genre: Genre | null; totalPages: PageCount | null; events: readonly ReadingEvent[] }

function dayNumber(d: LocalDate): number;
function fromDayNumber(n: number): LocalDate;

function readThroughs(events: readonly ReadingEvent[]): ReadThrough[];     // research R3
function readingDays(books: readonly StatsBook[]): Map<LocalDate, number>; // day → pages
function heatLevel(isReadingDay: boolean, pages: number): 0 | 1 | 2 | 3 | 4;
function currentStreak(days: ReadonlySet<LocalDate>, today: LocalDate): Streak | null;
function longestStreak(days: ReadonlySet<LocalDate>): Streak | null;
function yearSummary(books: readonly StatsBook[], year: number): YearSummary;
function abandonRates(books: readonly StatsBook[]): { overall: AbandonStat; byGenre: AbandonStat[] };
function pace(book: StatsBook, today: LocalDate): Pace | null;           // research R7

function computeStats(books: readonly StatsBook[], opts: { year: number; today: LocalDate }): StatsView;
```

`StatsView` is plain JSON:

```ts
interface StatsView {
  year: number;
  years: number[];                         // years with ≥1 reading day, plus the current year; descending
  summary: YearSummary;                    // the selected year
  heatmap: { date: string; level: 0 | 1 | 2 | 3 | 4; pages: number }[]; // every day of the year
  current: Streak | null;
  longest: Streak | null;
  allTime: { year: number; readingDays: number; booksFinished: number; pages: number }[];
  abandon: { overall: AbandonStat; byGenre: AbandonStat[] };
  hasAnyEvents: boolean;                   // drives the empty-state hint (FR-019)
}
```

Invariants, tested in `packages/core/test/stats*.test.ts`:

1. **Determinism.** The same input always gives a deep-equal output, and the input
   order of books or events doesn't matter.
2. **Streaks and days.** `current.length ≤ longest.length`, and the longest streak is a
   subset of reading days.
3. **Totals add up.** The sum over the year's `months.pages` equals `summary.pages`.
   The sum over `allTime` pages equals the sum of all credits.
4. **Heatmap size.** `heatmap.length` is 365, or 366 in a leap year.
5. **Pages are never negative.** No credit is below 0.
6. **Removals.** Removing any event, or any book, never increases any count.
7. **Abandoning.** A bare `abandoned` event never creates a reading day.

## Db (`packages/db/src/stats.ts`)

```ts
function loadStatsBooks(db: Database): StatsBook[];   // one query (research R8); books only
function statsView(db: Database, year: number, today: LocalDate): StatsView;
```

`BookView` (from 001/002) gains:

```ts
interface BookView {
  card: BookCard; events: BookEventView[];
  pace: Pace | null;                                           // new
  readThroughs: { start: string; end: string; daysToFinish: number }[];   // new: finished ones, newest first
}
```

## Worker protocol (`apps/pwa/src/lib/protocol.ts`)

| Query | New or changed | Result |
|---|---|---|
| `{ name: 'stats'; year: number; today: string }` | new | `StatsView` |
| `{ name: 'book'; itemId: string; today: string }` | `today` added | `BookView` with `pace` and `readThroughs` |

- The shell always passes `today = todayLocal()`.
- The worker parses `today` with `parseLocalDate`. A bad value gives
  `{ kind: 'Storage', message }`, which the UI can't cause.
