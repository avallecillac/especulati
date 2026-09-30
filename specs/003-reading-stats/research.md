# Research: Reading Stats (003)

## R1. Where stats are computed

- **Decision**: in **pure functions in `packages/core/src/stats.ts`**, over the book
  events that the DB worker loads with one query.
  - The worker loads every non-removed event of every non-removed **book**: one `SELECT`
    joined to `items` with `type = 'book'`, returning `item_id`, `genre`, `total_pages`
    and the event columns.
  - It groups them per book and calls `computeStats(books, { year, today })`.
- **Rationale**:
  - The rules are sequential per book (read-throughs, FR-006's first-page rule,
    "highest page so far"). They are awkward and fragile in SQL window functions, but
    plain and easy to test in TypeScript.
  - Pure core functions are tested with no mocks and no database (constitution VII),
    against hand-computed fixtures (SC-002).
  - Volume is small: 10 years of daily logging is about 10,000 events. One query plus
    a linear pass is well under the 200 ms budget (R8).
  - The same functions serve the Stats screen and the book screen (pace, read-throughs):
    two real call sites.
- **Alternatives considered**:
  - SQL per stat, as sketched in `docs/architecture.md` §9. That's fine for reading
    days, but pages per read-through and the first-page rule need recursive or window
    SQL that is hard to review. Rejected; §9 is updated to say stats are computed in
    core from one query.
  - Materialized stats tables updated on write: needless state, and wrong after sync
    or backdating unless rebuilt. Rejected (constitution III: derive, don't store).

## R2. Calendar arithmetic in the pure core

- **Decision**: `dayNumber(LocalDate) → number` (days since 1970-01-01) and its inverse
  `fromDayNumber`, using the days-from-civil algorithm (Howard Hinnant). Consecutive
  days, streaks, day spans and "today − 13" all use day numbers.
- **Rationale**: core can't use `new Date` (lint rule), and must not depend on the
  host's time zone. Integer calendar arithmetic is exact, DST-proof, and consistent with
  `previousLocalDate` (001 R6).
- **Alternatives**: `Date.UTC` arithmetic. It's a static call, but it's banned in core
  by the same rule in spirit and adds nothing. Rejected.

## R3. Read-through segmentation and page credit

- **Decision**: per book, take events in `eventOrder` (local_date, occurred_at, id;
  amended in R4). Walk them:
  1. A read-through opens at the first event, or at the first event after a
     `finished` or `abandoned`. It closes at the next `finished` or `abandoned`.
  2. `began` = a `started` event comes before the read-through's first page-bearing
     event, or the read-through has a `started` and no pages.
  3. For each event with a page: `credit = max(0, page − high)`, where `high` is the
     highest page seen so far in this read-through. For the first page-bearing event,
     `high` is 0 if `began`, else the page itself (credit 0, FR-006). Then
     `high = max(high, page)`.
  4. Credit goes to the event's `local_date`.
- **Rationale**: this matches the spec's scenarios exactly, including corrections to a
  lower page (credit 0, nothing subtracted) and re-reads (a new read-through restarts
  `high`).
- **Edge**: a backdated event can land before `started` in order, and it then opens
  the read-through. If it has no page, the start still comes before the first page, so
  that page counts in full. If it has a page, that page is the baseline (credit 0).
  Fixtures pin both cases.

## R4. Abandoning at a page (FR-022)

- **Decision**: "Abandon at page N" is **one `LogEvent` command** of type `abandoned`
  with `page` and a second id, `pageEventId`. `decide` emits **two** event inserts on
  the same `local_date` and `occurred_at`: `progress` (page N, id `pageEventId`), then
  `abandoned` (no page).
  - `eventOrder` gains a tie-break: when `local_date` and `occurred_at` are equal,
    `started` and `progress` sort before `finished` and `abandoned`, and only then by
    id.
  - A page on `started` or `finished` is still `PageNotAllowed`, and so is a page on
    `abandoned` without `pageEventId`.
- **Rationale**:
  - The v1 schema has `CHECK (page IS NULL OR (page > 0 AND event_type = 'progress'))`.
    SQLite can't alter a CHECK, so storing a page on `abandoned` needs a table rebuild
    (migration 3) and a sync-format change for every peer. The two-event form needs
    neither.
  - Stats need no special case: the progress entry makes the day a reading day and
    carries the pages. A bare abandon never counts (FR-002).
  - It's the same pattern as `AddBook` + `startNow`, which emits an item and a
    `started` event with a shell-supplied `startEventId`.
  - Without the tie-break, the two events would order by random id, and half the time
    the book would derive as "reading". The tie-break is deterministic on every device.
- **Alternatives**:
  - Migration 3 rebuilding `reading_events`: rejected, for a bigger blast radius for
    the same outcome.
  - Two separate `dispatch` calls from the UI: rejected, because they aren't atomic,
    and a crash between them leaves half an action.
  - Offsetting `occurred_at` by 1 ms: rejected; it needs timestamp arithmetic in core
    and is more surprising than an explicit rule.
- **Page validation**: the same as progress: `InvalidPage` or `PageBeyondEnd`. A page
  below the last page is accepted (credit 0).
- **Undo**: the "Undo" toast removes the events the shell created. The shell generated
  both ids, so no new outcome field is needed. It removes the `abandoned` event first,
  then the `progress` event, as two `RemoveEvent` dispatches.
  - If the second one fails, the book is left reading at page N. That's a valid,
    visible state, and the user can remove that entry by hand.

## R5. Heatmap levels and rendering

- **Decision**: 5 levels. 0 = not a reading day. For reading days: 1 = 0 pages credited
  (page-less, or a lower-page correction), 2 = 1–19, 3 = 20–49, 4 = 50 or more.
  - Rendered as an HTML grid, 7 rows (Mon–Sun) × 53–54 columns, with month labels.
    Each cell has `aria-label="Mar 3: 42 pages"` (or "read, no pages logged", or "no
    reading"), and the grid scrolls sideways on narrow screens.
  - Colours come from one sequential ramp in CSS variables, in light and dark.
- **Rationale**: fixed thresholds are stable year to year, and quantile levels would
  shift as data grows. An HTML grid needs no dependency (constitution VI) and is
  accessible (FR-021).
- **Alternatives**: SVG, or a chart library. Rejected: no gain for a fixed grid.

## R6. Streaks and "today"

- **Decision**:
  - The worker query receives `today` from the shell (`todayLocal()`); core never reads
    the clock.
  - Reading days after `today` are dropped from the current-streak calculation only.
    They still count in their year and in the longest streak.
  - The current streak walks back from `today` if it's a reading day, else from
    `today − 1`.
  - The longest streak is one pass over the sorted distinct day numbers. Ties keep the
    **most recent** run.
- **Rationale**: this matches FR-009 and FR-010. Passing `today` in keeps the query
  deterministic in tests.

## R7. Pace and estimate

- **Decision**:
  - The window is `[today − 13, today]`, limited to the current (open) read-through and
    its credited pages.
  - The divisor is `min(14, today − readThroughStart + 1)`.
  - `pace = pages / divisor`, shown to 1 decimal place.
  - `daysLeft = ceil((totalPages − lastPage) / pace)`. When the remaining pages are 0,
    no estimate is shown: the book is at its last page, and the app already offers to
    finish it.
  - The finish date is `fromDayNumber(dayNumber(today) + daysLeft)`.
- **Rationale**: this is exactly FR-014 and FR-015. The spec example (140 pages in 14
  days, 140 pages left) gives 10.0 pages/day and 14 days.

## R8. Performance

- **Decision**:
  - One indexed query: events joined to items, filtered on `deleted_at`. It uses the
    existing `idx_events_item` index (001).
  - Plus an O(n log n) sort per book and linear passes. No caching.
  - Tests:
    - a db perf test on a synthetic 10-year database (about 3,650 reading days, 400
      books, 10,000 events): the `stats` query must take under 100 ms in Node;
    - an e2e perf check: the Stats screen shows its numbers within 200 ms of navigation
      on the production build (SC-001).
- **Rationale**: "measure before optimizing" (constitution). 001's queries at 5,000
  events took about 50 ms, including grouping.
- **Fallback, if over budget**: cache the loaded events in the worker, invalidated on
  every `dispatch`. That needs no schema change. It isn't planned.
- **Measured (2026-09-30, T025):** the joined query took 130 to 180 ms at 10,000 events.
  Almost all of it was copying one row per event across the WASM boundary; the core maths
  took about 14 ms.
- **Fix, instead of the cache:** SQLite packs each book's events into one JSON array
  (`json_group_array`), so 400 rows cross the boundary instead of 10,000. That brought
  `stats()` down to **25 ms**. The budget is unchanged, and no cache is needed.

## R9. Where stats appear

- **Decision**:
  - A new **Stats** tab between Add and Settings (FR-018) holds:
    - the headline reading days;
    - a year picker, listing only years with data plus the current year;
    - the heatmap;
    - both streaks;
    - the monthly table (books finished and pages);
    - pages per reading day;
    - average days to finish;
    - abandon rate by genre;
    - an **All time** table.
  - **The book screen** gains:
    - for a reading book: pace, days left and the finish date;
    - for any book: the list of finished read-throughs with their days to finish.
- **Rationale**: one tap from anywhere (SC-004). Pace belongs where the user logs.
- **Refresh (FR-020)**: both screens re-query through the existing `dbClient` listener
  that fires after each `dispatch` and on another tab's broadcast.

## R10. Articles later (FR-005, SC-005)

- **Decision**: the loader filters `items.type = 'book'`. `computeStats` takes books
  only. A db test inserts article rows, with and without `read_on`, directly into
  `items` and asserts that the stats are unchanged.
  - Feature 005 adds a separate `articleStats` function and query. Nothing in 003
    reserves UI for it.
- **Rationale**: this enforces "articles never count" at the data boundary, and it is
  tested now, before articles exist.

## R11. No new dependencies, no migration

- **Decision**: no new runtime or dev dependencies, and schema version stays 2. The
  heatmap is HTML and CSS; date maths is our own ~20 lines.
