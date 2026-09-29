# Implementation Plan: Reading Stats

**Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `003-reading-stats`) | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-reading-stats/spec.md`

## Summary

This feature adds a **Stats** tab and pace information on the book screen. Everything is
derived on the device from the existing event log, with no schema change.

- **Computation**: the DB worker loads every live book event with one query. Pure
  functions in `packages/core/src/stats.ts` then compute:
  - read-throughs;
  - pages credited per day, including FR-006's "first page counts only if started"
    rule;
  - reading days, the heatmap and streaks;
  - year and month summaries;
  - days to finish;
  - abandon rate by genre;
  - pace.
- **Abandon at a page** (FR-022): one `LogEvent` emits a `progress` event and an
  `abandoned` event. `eventOrder` gains a type tie-break, so this needs no migration
  (research R4).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22. Unchanged.

**Primary Dependencies**: none new (research R11).

**Storage**: SQLite schema v2, unchanged. It adds one read query (research R8).

**Testing**:

- **Vitest core**: hand-computed stats fixtures covering every edge case in
  constitution VII, the invariants in `contracts/stats.md`, and the abandon-at-page
  command and its property invariants.
- **Vitest db**: the loader, the exclusion of articles and removed rows, and perf on a
  10-year synthetic database.
- **Playwright**: the Stats screen, heatmap accessibility, book pace, abandon at a page
  with Undo, refresh after logging, and perf.

**Target Platform**: iOS 17+ installed web app, and Chrome on the Mac. Unchanged.

**Project Type**: the existing monorepo. **No new packages.**

**Performance Goals**:

- The `stats` query takes under 100 ms in Node on 10 years of data.
- The Stats screen renders within 200 ms (SC-001, constitution).

**Constraints**:

- Computed entirely offline (FR-001).
- Only books count (FR-005).
- `today` comes from the shell (`clock.ts`).

**Scale/Scope**:

- 4 user stories.
- 1 new screen (Stats), plus changes to BookDetail (pace, read-throughs, and the page
  field when abandoning).
- 1 command change, 1 ordering rule, 1 new worker query, and 1 extended query.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Local-first | All stats are computed from the local DB, with no network (FR-001). | PASS |
| II. The user owns the data | Nothing new is stored or sent. Abandon-at-page is two ordinary events, so they travel in `change_log` and the future export like any other. | PASS |
| III. Events over state | Stats and pace are derived, never stored. Reading days use the explicit `local_date`, and articles never count (FR-004, FR-005). The page entered on abandon is an appended `progress` event, not an edit. | PASS |
| IV. Functional core, imperative shell | All stat maths lives in pure core. Date arithmetic is integer day numbers with no `Date` (R2). The shell supplies `today`. The two-event abandon goes through `decide` in one transaction. | PASS |
| V. Near-zero friction | "Read today" and progress logging are untouched. Abandoning stays at 2 taps (Abandon → Confirm). The page field is optional and starts empty (FR-022). | PASS |
| VI. Simplicity | No dependency, no migration, no cache, and no new package. The heatmap is HTML and CSS. Stats functions have two call sites (the Stats screen and the book screen). | PASS |
| VII. Verified correctness | Stats fixtures cover backdated and page-less events, several events on one day, tombstones, year boundaries and re-reads (SC-002). The command change has property invariants (I-9, I-10). | PASS |
| Tech constraints | 200 ms on 10 years of data is measured in db and e2e perf tests (R8). No migration. | PASS |

**Post-design re-check (after Phase 1):** PASS.

- `eventOrder`'s new tie-break changes the order only for events with an identical
  `(local_date, occurred_at)`. Before 003, no command emitted two events, so no
  existing events tie, and existing data orders exactly as before.
- `docs/architecture.md` §9 ("on-device SQL") is updated to "one query plus pure core
  functions" (R1).
- `specs/001-local-book-log/contracts/commands.md` gets a pointer to
  `contracts/commands-003.md`.

## Project Structure

### Documentation (this feature)

```text
specs/003-reading-stats/
├── plan.md
├── research.md            # R1–R11
├── data-model.md          # derived values; the eventOrder / LogEvent amendment
├── quickstart.md          # scenarios 1–19
├── contracts/
│   ├── stats.md           # core functions, StatsView, db loader, worker queries
│   └── commands-003.md    # LogEvent + pageEventId, eventOrder tie-break, invariants I-9/I-10
├── checklists/requirements.md
└── tasks.md               # /speckit-tasks
```

### Source Code (changes and additions)

```text
packages/core/src/
├── stats.ts            # new: dayNumber, readThroughs, readingDays, streaks, yearSummary, abandonRates, pace, computeStats
├── book.ts             # eventOrder type tie-break
├── commands.ts         # LogEvent.pageEventId
└── decide.ts           # abandon at a page → progress + abandoned
packages/core/test/     # stats.*.test.ts (fixtures + invariants), decide.logEvent additions, property test additions

packages/db/src/
├── stats.ts            # new: loadStatsBooks, statsView
└── queries.ts          # bookView + pace, readThroughs (takes today)
packages/db/test/       # stats.test.ts (tombstones, articles excluded), perf.test.ts additions

apps/pwa/src/
├── lib/protocol.ts     # stats query; book query + today
├── worker/db.worker.ts # handle stats; pass today to book
├── App.svelte          # Stats tab
└── screens/
    ├── Stats.svelte    # new: year picker, headline, heatmap, streaks, months, all time, abandon
    ├── Heatmap.svelte  # new: accessible grid
    └── BookDetail.svelte  # pace/estimate, read-throughs, optional "stopped at page" on abandon, 2-event undo

e2e/
└── stats.spec.ts, book-pace.spec.ts, abandon-page.spec.ts; perf.spec.ts addition
```

**Structure Decision**: no new packages. The stats maths lives in core, next to
`deriveStatus`, and its only consumers are the db read models.

## Complexity Tracking

No constitution violations.
