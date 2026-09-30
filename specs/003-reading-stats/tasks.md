---

description: "Task list for 003-reading-stats"
---

# Tasks: Reading Stats

**Input**: Design documents from `/specs/003-reading-stats/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R11), data-model.md, contracts/ (stats, commands-003), quickstart.md

**Tests**: REQUIRED (Constitution VII). Write each test task first and confirm it fails
before implementing it.

**Execution**: per CLAUDE.md "Model roles", each task, or each `[P]` batch, goes to the
`implementer` agent (Sonnet). The main session reviews and commits after each phase.

**Always-applicable rules for every task:**

- **`packages/core` is pure.** It must not use the DOM, `fetch`, `Date.now`, `new Date`,
  `Date.UTC`, `Math.random` or `crypto.randomUUID`, and must not import other packages.
  Date maths uses `dayNumber` and `fromDayNumber` only (research R2).
- **`today` is never read in core or in the worker.** The UI passes `todayLocal()` from
  `apps/pwa/src/lib/clock.ts`.
- **Only books count.** Removed events and removed books are excluded everywhere
  (FR-003, FR-005).
- **No schema change.** `SCHEMA_VERSION` stays 2, and no new dependencies are added.
- **The UI talks to SQLite only through `apps/pwa/src/lib/dbClient.ts`.**
- **Svelte 5 `{@const}` is derived.** In handlers, copy the values you need before
  clearing the state it derives from.
- **Core test fixtures.** Use the helpers in `packages/core/test/fixtures.ts`: `book()`,
  `event({ type, page, localDate, occurredAt })`, `day()`, `itemId(n)`.
- **E2e seeding for past dates.** Use `page.clock.install({ time })` or
  `page.clock.setFixedTime(...)` and reload, then log through the UI. Put a
  `logOnDay(page, isoDate, opts)` helper in `e2e/helpers.ts`.

**Status (2026-09-29):** Phase 1 and US1 (the MVP) are shipped. **US2, US3, US4 and
Polish (T012–T027) are parked** while 004 (encrypted sync) goes ahead.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational (blocks all stories)

**Purpose**: calendar maths, the event-order tie-break, read-throughs, and
pages-per-day credits (research R2, R3, R4), plus the db loader (R1, R8, R10).

### Tests first

- [X] T001 [P] Write `packages/core/test/stats.dates.test.ts` for
  `dayNumber(d: LocalDate): number` (days since 1970-01-01) and
  `fromDayNumber(n): LocalDate`:
  - `dayNumber('1970-01-01') === 0`, `dayNumber('2000-03-01') === 11017`,
    `dayNumber('2026-09-29') === 20725`;
  - 2024-02-28 → 2024-02-29 → 2024-03-01 are consecutive; 2025-02-28 → 2025-03-01 are
    consecutive; 2025-12-31 → 2026-01-01 are consecutive;
  - a round trip for every day from 1999-01-01 to 2031-12-31;
  - agreement with `previousLocalDate` for 1,000 sampled days.
- [X] T002 [P] Extend `packages/core/test/book.test.ts` for the `eventOrder` tie-break
  (contracts/commands-003.md):
  - for two events with an equal `(local_date, occurred_at)`, `progress` and `started`
    sort before `abandoned` and `finished`, **whatever their ids are** (test both id
    orders);
  - in that case `deriveStatus` gives `abandoned` and `lastPage` gives the progress
    page;
  - equal type rank still falls back to id order;
  - different `occurred_at` values still sort by time, as in 001.
- [X] T003 [P] Write `packages/core/test/stats.readthrough.test.ts` for
  `readThroughs(events)` and `readingDays(books)` (research R3, data-model
  `ReadThrough` and `DayStat`), each with hand-computed expectations:
  - **started, then pages 40, 90, 150**: credits 40, 50, 60 on their days;
  - **no `started`, first page 40**: credit 0; then page 90 gives 50;
  - **a lower page**: 120 then 100 gives a credit of 0; a later 130 gives 10;
  - **a re-read**: after `finished`, `started`, then page 30 gives 30; a new
    read-through with `began = true`;
  - **abandon, then resume** with progress page 200 (no `started`): a new read-through
    with `began = false`, so the first page's credit is 0;
  - **a backdated event** that sorts before `started`: it opens the read-through, and
    `began = false`;
  - **`outcome` and `end`**: `finished`, `abandoned` or `open`; `daysToFinish` for Mar 1
    → Mar 10 is 10, and 1 for the same day;
  - **`readingDays`**: a page-less `progress` day is a key with 0 pages; `started` and
    `finished` days are keys; a bare `abandoned` day is **not** a key; two books on one
    day sum their pages; several events on one day count once;
  - **removed events** (`deletedAt` set) are ignored.

### Implementation

- [X] T004 Implement in `packages/core`:
  - in `src/book.ts`: `eventOrder` sorts by `(localDate, occurredAt, typeRank, id)`,
    where `started` and `progress` rank 0 and `finished` and `abandoned` rank 1;
  - new `src/stats.ts`:
    - `dayNumber` and `fromDayNumber` (days-from-civil, integer only);
    - `ReadThrough`, `readThroughs`, `StatsBook`, and
      `readingDays(books): Map<LocalDate, number>`;
    - `heatLevel(isReadingDay, pages)`: 0 when not a reading day, 1 for 0 pages, 2 for
      1–19, 3 for 20–49, 4 for ≥ 50;
  - export from `src/index.ts`.

  T001–T003 must pass, and all existing core tests must stay green.
- [X] T005 Write `packages/db/test/stats.test.ts` (loader part) for
  `loadStatsBooks(db)`:
  - books added through `dispatch`, with events, are returned with `genre`,
    `totalPages` and their non-removed events;
  - a removed event is absent;
  - a removed book is absent, with all its events;
  - **articles are excluded**: insert rows directly with
    `INSERT INTO items (id, type, title, created_at, read_on) VALUES (…, 'article', …)`
    and check they never appear (FR-005, SC-005).

  Then implement `packages/db/src/stats.ts` with `loadStatsBooks`, using **one** query:
  events joined to items, filtered on `i.type = 'book'`, `i.deleted_at IS NULL` and
  `e.deleted_at IS NULL`, then grouped in memory. Books with no events are included,
  with `events: []`. Export it from `packages/db/src/index.ts`.

**Checkpoint**: `pnpm typecheck && pnpm lint && pnpm test` green.

---

## Phase 2: User Story 1 - See how many days I read this year (Priority: P1) 🎯 MVP

**Goal**: a Stats tab with this year's reading days, a year picker, the heatmap, and the
current and longest streaks.

**Independent Test**: log on chosen days, including backdated and page-less entries.
Stats should show the right count, the right marked days, and the right streaks.

### Tests for User Story 1

- [X] T006 [P] [US1] Write `packages/core/test/stats.streaks.test.ts` for
  `currentStreak(days, today)` and `longestStreak(days)` (research R6):
  - today plus the 2 days before gives 3;
  - yesterday and the day before, but not today, gives 2 (still alive);
  - a last day 2 days ago gives `null` (shown as 0);
  - a future day (today + 3) is ignored by `currentStreak`, but counts toward
    `longestStreak`;
  - Dec 30 → Jan 2 gives a length of 4 with the correct start and end;
  - of two equal longest runs, the **most recent** wins;
  - an empty set gives `null`.
- [X] T007 [P] [US1] Write `packages/core/test/stats.view.test.ts` (US1 part) for
  `computeStats(books, { year, today })`:
  - **`heatmap`**: 365 entries for 2025 and 366 for 2024, dated Jan 1 to Dec 31, with
    the right level and pages on reading days;
  - **`years`**: descending; includes years with a reading day plus the year of
    `today`; a future-dated day's year is included;
  - **`summary.readingDays`**: for the selected year only (a Dec 30 → Jan 2 history
    gives 2 and 2);
  - **`hasAnyEvents`**: false for no books or books with no events;
  - **invariants 1, 2, 4 and 7** in contracts/stats.md, with input orders shuffled
    (a deterministic shuffle with a fixed seed written in the test, not
    `Math.random`).
- [X] T008 [P] [US1] Write `e2e/stats.spec.ts` (US1 part):
  - **empty DB**: the Stats tab shows "0" reading days and the hint text, not an error
    (FR-019);
  - **backdated day**: with the clock at 2026-06-15, add a book, log a page today, and
    log "Read today" with **Yesterday**. Stats shows **2** reading days and current
    streak **2**.
    - The heatmap cells for 2026-06-14 and 2026-06-15 have accessible names containing
      "Jun 14" and "Jun 15" (FR-021).
    - The 06-14 cell says "read, no pages logged".
  - **refresh**: log another page, then open Stats **without reloading**. The count
    updates (FR-020, SC-003).
  - **year picker**: pick 2025, and it shows 0 reading days. *As built:* the picker
    only lists years with data plus the current year, so the test seeds 2025-12-31 and
    2026-01-01/02, then checks the options are 2026 and 2025, and that 2025 shows 1
    reading day.
  - **one tap**: the Stats tab link is visible from Home (SC-004).

### Implementation for User Story 1

- [X] T009 [US1] In `packages/core/src/stats.ts`, implement:
  - `currentStreak` and `longestStreak`, returning
    `Streak = { start: LocalDate; end: LocalDate; length: number }`;
  - `computeStats(books, { year, today })`, returning
    `StatsView = { year, years, summary: { year, readingDays }, heatmap, current, longest, hasAnyEvents }`.

  The remaining `StatsView` and `YearSummary` fields are added in T013 and T024.
  T006 and T007 must pass.
- [X] T010 [US1] Add stats to the db and worker:
  - `packages/db/src/stats.ts`: `statsView(db, year, today) = computeStats(loadStatsBooks(db), { year, today })`;
  - a `ReaderlogDb.stats(year, today)` method;
  - `apps/pwa/src/lib/protocol.ts`: the query
    `{ name: 'stats'; year: number; today: string }`, with result `StatsView`;
  - `apps/pwa/src/worker/db.worker.ts`: handle it. Parse `today` with
    `parseLocalDate`; a bad value gives `{ kind: 'Storage', message }`.
- [X] T011 [US1] Build the Stats screen:
  - `apps/pwa/src/screens/Heatmap.svelte`:
    - a CSS grid of 7 rows (Mon–Sun) by week columns, with month labels;
    - one cell per `heatmap` entry, whose class is its level (0–4), coloured from CSS
      variables with a light and a dark ramp;
    - each cell has `role="img"` and an `aria-label` such as "Mar 3: 42 pages",
      "Mar 3: read, no pages logged" or "Mar 3: no reading";
    - the grid is wrapped in a horizontally scrollable region.
  - `apps/pwa/src/screens/Stats.svelte`:
    - the headline "N reading days in YYYY";
    - a year `<select>` built from `years`;
    - `Heatmap`;
    - "Current streak: N days" and "Longest streak: N days (start – end)";
    - when `hasAnyEvents` is false, the hint "Log reading from a book to see stats
      here.";
    - it re-queries with `onChanged` (as `BookDetail` does), always passing
      `today: todayLocal()`.
  - `apps/pwa/src/App.svelte`: a `Stats` tab (`#/stats`) between Add and Settings, and
    the route in `lib/router.svelte.ts`.

  T008 must pass, and all existing e2e tests must stay green.

**Checkpoint**: MVP. The headline stat, heatmap and streaks work offline.

---

## Phase 3: User Story 2 - Books finished and pages per month and year (Priority: P2)

**Goal**: monthly and yearly books finished and pages read, pages per reading day, and
an All-time table.

**Independent Test**: log a book through to the end over several days, then check the
month's counts and the average.

### Tests for User Story 2

- [X] T012 [P] [US2] Extend `packages/core/test/stats.view.test.ts` for
  `yearSummary(books, year)` and `allTime`:
  - 2 books finished in March and 1 in April give `months[2].booksFinished = 2` and
    `months[3].booksFinished = 1`;
  - a re-read finished in the same year counts twice;
  - pages 40, 90, 150 with `started` give month pages 150;
  - 300 pages over 10 reading days give `pagesPerReadingDay = 30`, and 0 reading days
    give `null`;
  - a removed book's finishes and pages vanish (invariant 6);
  - `allTime` has one row per year with a reading day, and its sums match invariant 3;
  - a year boundary: pages dated Dec 31 go to that year, and Jan 1 to the next.

### Implementation for User Story 2

- [X] T013 [US2] Implement in `packages/core/src/stats.ts`:
  - `yearSummary`, adding `booksFinished`, `pages`, `pagesPerReadingDay` (rounded to a
    whole number, or `null`) and `months: { month: 1..12; booksFinished; pages }[]`
    (always 12 entries);
  - `computeStats` gains `allTime: { year; readingDays; booksFinished; pages }[]`,
    ordered by year descending.

  T012 must pass.
- [X] T014 [US2] In `apps/pwa/src/screens/Stats.svelte`, add:
  - for the selected year, "Books finished: N", "Pages read: N" and "Pages per reading
    day: N" (or "—");
  - a 12-row month table (Month | Books | Pages);
  - a year / **All time** toggle that shows the `allTime` table.

  Then extend `e2e/stats.spec.ts`:
  - add a 100-page book with **Start reading now**;
  - log page 40 on day 1 and page 100 on day 2, then **Mark finished**;
  - Stats shows Books finished **1**, Pages read **100**, and Pages per reading day
    **50**;
  - the month row matches.

---

## Phase 4: User Story 3 - Know when I'll finish my current book (Priority: P2)

**Goal**: pace and an estimated finish on the book screen.

**Independent Test**: log progress on a book with a known page count, then open it and
check the pace, the days left and the date.

### Tests for User Story 3

- [X] T015 [P] [US3] Write `packages/core/test/stats.pace.test.ts` for
  `pace(book, today)` (research R7):
  - **the spec example**: a 300-page book, a read-through started 20 days ago, 140
    pages credited in the last 14 days and last page 160 give `pagesPerDay: 10`,
    `daysLeft: 14` and `finishDate: today + 14`;
  - a read-through started 4 days ago (counting both ends), with 40 pages, gives a
    divisor of 4 and a pace of 10;
  - credits older than 13 days before today are excluded;
  - credits from the **previous** read-through are excluded;
  - no `totalPages`, or no `lastPage`, gives `daysLeft` and `finishDate` of `null`, but
    `pagesPerDay` still set;
  - no credits in the window gives `pagesPerDay: 0` and a `null` estimate;
  - `lastPage === totalPages` gives a `null` estimate;
  - a finished, abandoned or queued book gives `null`;
  - rounding: `daysLeft` is rounded up.
- [X] T016 [P] [US3] Write `e2e/book-pace.spec.ts`:
  - a 300-page book, started with the clock on day 1;
  - log page 20 on day 1 and page 40 on day 2, then open the book on day 2;
  - the screen shows "20 pages/day" and "about 13 days left" with the finish date;
  - a book with no total pages shows no estimate.

### Implementation for User Story 3

- [X] T017 [US3] Implement `pace` in `packages/core/src/stats.ts`, returning
  `Pace = { pagesPerDay: number; daysLeft: number | null; finishDate: LocalDate | null } | null`.
  `pagesPerDay` is rounded to 1 decimal place for display only, and the estimate uses
  the unrounded value.
  T015 must pass.
- [X] T018 [US3] Pass `today` to the book query:
  - `packages/db/src/queries.ts`: `bookView` / `ReaderlogDb.book(itemId, today)`
    returns `pace: Pace | null`.
  - Update `packages/db/test/perf.test.ts` and the other `book(...)` callers to pass a
    `today`.
  - `protocol.ts`: `{ name: 'book'; itemId: string; today: string }`.
  - The worker parses `today`.
  - `BookDetail.svelte` queries with `today: todayLocal()`, and for a reading book
    shows:
    - "N pages/day · about D days left (around <date>)";
    - or "No recent pace" when the pace is 0;
    - or nothing when `pace` is `null`.

  T016 must pass, and all existing e2e tests must stay green.

---

## Phase 5: User Story 4 - Understand how I finish and abandon books (Priority: P3)

**Goal**: days to finish, the abandon rate by genre, and abandoning at a page.

**Independent Test**: create finished and abandoned books with and without genres,
abandon one at a page, then check every number.

### Tests for User Story 4

- [ ] T019 [P] [US4] Extend `packages/core/test/decide.logEvent.test.ts` per
  contracts/commands-003.md:
  - `abandoned` with `page: 120` and a valid `pageEventId` on a reading book emits
    exactly 2 event inserts, in order:
    - `progress` (id `pageEventId`, page 120);
    - `abandoned` (id `eventId`, page null);
    - both with the same `local_date` and `occurred_at = now`.
  - `offerFinish` is false.
  - A page without `pageEventId` gives `PageNotAllowed`.
  - `pageEventId === eventId`, or a non-UUID, gives
    `InvalidInput { field: 'pageEventId' }`.
  - Page 0 gives `InvalidPage`, and a page above `totalPages` gives `PageBeyondEnd`.
  - A page below the last page is accepted.
  - On a queued book, the result is `InvalidTransition`.
  - `started` or `finished` with a page is still `PageNotAllowed`.

  Also extend `packages/core/test/decide.property.test.ts` with invariants **I-9** and
  **I-10** (random ids and pages).
- [ ] T020 [P] [US4] Extend `packages/core/test/stats.view.test.ts` for abandon rates and
  days to finish:
  - 3 finished and 1 abandoned "Fiction" books, plus 2 finished books with no genre,
    give:
    - Fiction: 25%, finished 3, abandoned 1;
    - No genre (`genre: null`): 0%;
    - overall: 17%.
  - A book abandoned, then resumed and finished, counts as finished.
  - A reading or queued book is not counted.
  - A genre with only reading books is not listed.
  - `summary.avgDaysToFinish` for the read-throughs finished in the year: 10 and 1
    give 5.5, and none gives `null`.
  - **Abandon at a page**: page 120 after a last page of 90 gives today as a reading
    day with 30 pages. A bare abandon with nothing else that day gives no reading day
    (US4 · 6–7).
- [ ] T021 [P] [US4] Write `e2e/abandon-page.spec.ts`:
  - **abandon at a page**: on a reading 300-page book at page 90, tap **Abandon**. The
    dialog has an empty "Stopped at page (optional)" field with placeholder "90".
    Enter 120 and confirm.
    - The book shows Abandoned, and its history has "Page 120" and then "Abandoned".
    - Stats shows today as a reading day with 30 pages.
  - **undo**: the toast's **Undo** restores Reading at page 90, and both entries are
    gone.
  - **bare abandon**: abandoning without a page on a day with no other entries adds no
    reading day.
  - **days to finish**: a finished book shows "Finished in N days" on its screen.

### Implementation for User Story 4

- [ ] T022 [US4] Implement abandoning at a page in `packages/core`:
  - `src/commands.ts`: add `readonly pageEventId?: string` to `LogEvent`.
  - `src/decide.ts`: validate in this order: `pageEventId`, page, transition. Then emit
    the 2 inserts.

  T019 must pass, including the property tests.
- [ ] T023 [US4] Make the abandon dialog take a page, in `BookDetail.svelte` and
  `lib/actions.ts`:
  - the Abandon confirmation gets an optional numeric input "Stopped at page
    (optional)", **empty by default**, with `placeholder` set to the last page
    (FR-022);
  - on confirm, when a page is entered, dispatch one `LogEvent` with `type:
    'abandoned'`, `page`, `eventId` and `pageEventId` (both `crypto.randomUUID()`);
  - read the input value **before** clearing `confirming` (the Svelte gotcha);
  - add `toastSavedMany(message, itemId, eventIds[])` in `lib/actions.ts`. Its Undo
    removes the ids in the given order, abandoned first, then progress.
- [ ] T024 [US4] Add the finishing and abandoning stats:
  - in `packages/core/src/stats.ts`:
    - `abandonRates(books)`, returning `{ overall; byGenre }` of
      `AbandonStat = { genre: string | null; finished; abandoned; rate }`, where `rate`
      is a whole percentage;
    - `YearSummary.avgDaysToFinish` (1 decimal place, or null);
    - `computeStats` gains `abandon`;
  - `bookView` gains
    `readThroughs: { start; end; daysToFinish }[]` (finished only, newest first);
  - `Stats.svelte` shows "Average days to finish: N" and an abandon-rate table (Genre |
    Finished | Abandoned | Rate, with the overall row first and "No genre" last);
  - `BookDetail.svelte` shows "Finished in N days (start – end)" per finished
    read-through.

  T020 and T021 must pass.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T025 Add a performance check (SC-001, research R8):
  - `packages/db/test/perf.test.ts`: a new case with a synthetic 10-year database of 400
    books and about 10,000 events on about 3,650 distinct days (build rows with
    `dispatch`, as the existing perf test does). `db.stats(2026, '2026-09-29')` must
    take under 100 ms warm, and log its time.
  - `e2e/perf.spec.ts`: navigating to `#/stats` shows the headline within 200 ms on the
    production build. Seed as the existing perf spec does.
- [ ] T026 [P] Test articles end to end at the db level (SC-005): in
  `packages/db/test/stats.test.ts`, insert 50 article rows (with `read_on`, `domain`
  and `word_count`) into a populated DB and assert that `db.stats(...)` is deep-equal
  before and after.
- [ ] T027 Run the full validation (main session):
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e`, plus `pnpm e2e
    --repeat-each=2`;
  - run quickstart scenarios 1–19;
  - fill in "Validation results" in `quickstart.md`;
  - bump `apps/pwa/package.json` to `0.3.0`.

---

## Dependencies & Execution Order

- **Phase 1** blocks everything: T001–T003 run in parallel, then T004, then T005.
- **US1 (Phase 2)** depends on Phase 1. It adds the Stats screen that US2 and US4 extend.
- **US2** depends on US1 (it extends `computeStats` and `Stats.svelte`).
- **US3** depends only on Phase 1 and could run alongside US1. But it edits
  `protocol.ts` and `db.worker.ts`, which US1 also edits, so it runs after US1.
- **US4** depends on US1 (Stats) and US3 (`bookView` takes `today`). Within US4, T022
  (core) comes before T023 (UI), and T024 comes last.
- **Polish** runs after all stories.

Within each phase, tests are written first and must fail, then implementation follows.

## Parallel batches (for delegating to implementer agents)

| Batch | Tasks | Notes |
|---|---|---|
| A | T001, T002, T003 | separate test files |
| B | T004 → T005 | sequential, one agent |
| C | T006, T007, T008 | tests for US1 |
| D | T009 → T010 → T011 | one agent |
| E | T012 → T013 → T014 | one agent |
| F | T015, T016, then T017 → T018 | tests in parallel, then one agent |
| G | T019, T020, T021 | tests for US4 |
| H | T022 → T023 → T024 | one agent |
| I | T025, T026 | only one agent may build `dist` at a time |

## Implementation Strategy

1. **MVP**: Phase 1 plus US1. The headline stat, heatmap and streaks can ship on their
   own.
2. **Increment**: US2 adds the monthly and yearly numbers, and US3 adds pace on the
   book screen.
3. **Increment**: US4 adds finishing and abandoning stats, and abandoning at a page.
4. **Polish**: performance, the article guard, the validation run, then release 0.3.0.
