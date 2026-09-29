# Quickstart & Validation: Reading Stats (003)

## Automated checks

```bash
pnpm install
pnpm typecheck && pnpm lint
pnpm test   # core: stats fixtures + invariants, abandon-at-page; db: loader, articles excluded, perf
pnpm e2e    # stats screen, heatmap, book pace, abandon at page, refresh, perf
```

Expected: every command exits 0.

## Scenarios

| # | Scenario | Covers | How |
|---|---|---|---|
| 1 | Events on 3 days (2 on one day) → 3 reading days; exactly those days marked | US1 · 1, FR-002 | core fixture + e2e `stats.spec.ts` |
| 2 | A page-less "Read today" day counts (heatmap level 1) | US1 · 2, R5 | core |
| 3 | A backdated event counts on its own date and joins the streak | US1 · 3, FR-004 | core + e2e |
| 4 | Current streak: today+2 prior days → 3; yesterday but not today → still alive; 2 days ago → 0 | US1 · 4–6, FR-009 | core (fixed `today`) |
| 5 | Removing an event or a book drops its days and pages; streaks recomputed | US1 · 7, FR-003 | core + db tombstone fixture |
| 6 | Dec 30 → Jan 2 streak: per-year days split, streak = 4 | US1 · 8 | core |
| 7 | Empty history: zeros and a hint, no error | US1 · 9, FR-019 | e2e |
| 8 | Monthly books finished and pages; per-reading-day average | US2 · 1, 6 | core |
| 9 | First page with `started` counts in full, without it counts 0; lower page adds 0; re-read restarts | US2 · 2–4, FR-006 | core |
| 10 | Pace 10.0/day, 14 days left, finish date = today + 14 | US3 · 1, R7 | core + e2e `book-pace.spec.ts` |
| 11 | No estimate without total pages or logged page; "no recent pace" when 0; none when finished or abandoned | US3 · 2–4 | core |
| 12 | Days to finish Mar 1→10 = 10; same day = 1; re-read has two values | US4 · 1–3 | core |
| 13 | Abandon rate: Fiction 25%, No genre 0%, overall 17%; resumed-then-finished counts as finished | US4 · 4–5 | core |
| 14 | Abandon at page 120 (last 90): today is a reading day, +30 pages; bare abandon adds no day | US4 · 6–7, FR-022 | core + e2e |
| 15 | Abandon at page → Undo restores "reading" at the previous page | R4 | e2e |
| 16 | Article rows in `items` don't change any stat | FR-005, SC-005 | db |
| 17 | Log a page, open Stats: the new day shows without reload | FR-020, SC-003 | e2e |
| 18 | 10-year synthetic DB: `stats` query < 100 ms in Node; Stats screen < 200 ms in e2e | SC-001, R8 | db perf + e2e perf |
| 19 | Heatmap cells expose date and value to assistive tech | FR-021 | e2e (accessible names) |

## Manual checks (iPhone)

1. Open **Stats**: this year's reading days and the heatmap match your history.
2. Scroll the heatmap sideways; tap years in the picker.
3. On the current book: pace and "about N days left" look sensible.
4. Abandon a test book at a page, then Undo.

## Validation results

*Filled in after `/speckit-implement`.*
