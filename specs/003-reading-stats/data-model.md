# Data Model: Reading Stats (003)

**No schema change.** Schema version stays 2. Everything below is derived at query time
from `items` (books only) and `reading_events`. Nothing is stored.

## Inputs

`StatsBook` is one non-removed book, with its non-removed events:

| Field | Type | From |
|---|---|---|
| itemId | ItemId | `items.id` |
| genre | Genre \| null | `items.genre` |
| totalPages | PageCount \| null | `items.total_pages` |
| events | ReadingEvent[] | `reading_events` where `deleted_at IS NULL` |

Only rows with `items.type = 'book'` and `items.deleted_at IS NULL` are loaded
(FR-003, FR-005).

## Derived values (pure, `packages/core/src/stats.ts`)

### Day numbers

`dayNumber(d: LocalDate): number` counts days since 1970-01-01, and
`fromDayNumber(n): LocalDate` is its inverse (research R2).

### ReadThrough

One per segment of a book's ordered events (research R3):

| Field | Type | Rule |
|---|---|---|
| itemId | ItemId | |
| start | LocalDate | the first event's `local_date` |
| end | LocalDate \| null | the closing event's `local_date`; null while open |
| outcome | `'finished' \| 'abandoned' \| 'open'` | |
| began | boolean | the first event is `started` |
| credits | `{ date: LocalDate; pages: number }[]` | one per page-bearing event |
| daysToFinish | number \| null | `dayNumber(end) − dayNumber(start) + 1` if finished |

### DayStat

The reading days, as a `Map<LocalDate, number>` from day to pages credited that day.

- **Keys** are the `local_date`s of the counting events: `started`, `progress` and
  `finished`. A bare `abandoned` never counts. An abandon at a page is counted through
  its companion `progress` event (research R4).
- **Values** are the sums of that day's credits across all books. A value can be 0.

### Heatmap level (research R5)

| Level | Condition |
|---|---|
| 0 | not a reading day |
| 1 | reading day, 0 pages |
| 2 | 1–19 pages |
| 3 | 20–49 pages |
| 4 | ≥ 50 pages |

### Streak

`{ start: LocalDate; end: LocalDate; length: number }`. Rules are in research R6.

### YearSummary

| Field | Rule |
|---|---|
| year | `YYYY` |
| readingDays | the number of `DayStat` keys in that year |
| booksFinished | the number of `finished` events in the year |
| pages | the sum of credits dated in the year |
| pagesPerReadingDay | `round(pages / readingDays)`, or null when there are no reading days |
| avgDaysToFinish | the mean `daysToFinish` of read-throughs finished in the year, rounded to 1 decimal place, or null |
| months | 12 × `{ month, booksFinished, pages }` |

### AbandonStat

`{ genre: string | null; finished: number; abandoned: number; rate: number }`.

- It groups books by current `deriveStatus`, finished or abandoned only.
- `rate = round(100 · abandoned / (finished + abandoned))`.
- `genre = null` is shown as "No genre".
- There is an overall row, and one row per genre that has at least one finished or
  abandoned book.

### Pace (book screen)

`{ pagesPerDay: number; daysLeft: number | null; finishDate: LocalDate | null } | null`.

- It is null unless the book's status is reading.
- `pagesPerDay` is 0 when there are no credits in the window, shown as "no recent pace".
- `daysLeft` and `finishDate` are null when `pagesPerDay` is 0, when there is no
  `totalPages` or no `lastPage`, or when no pages remain.

## Changed domain rule (001 amendment)

- **`eventOrder` tie-break.** Events with an equal `(local_date, occurred_at)` are
  ordered by type rank first (`started` = `progress` < `finished` = `abandoned`), and
  then by id.
- **`LogEvent` of type `abandoned`** may carry `page` together with `pageEventId`. It
  emits a `progress` insert and then an `abandoned` insert, with the same `local_date`
  and `occurred_at` (research R4).
