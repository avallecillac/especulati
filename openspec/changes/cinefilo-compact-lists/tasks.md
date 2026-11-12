# Tasks

Checks = `pnpm typecheck`, eslint, depcruise, `pnpm test`, `pnpm --filter cinefilo build`, the Cinéfilo e2e specs (`npx playwright test cinefilo/` in `e2e/`).

## 1. Lists

- [x] 1.1 Tests first: `matchesQuery` unit test (case, accents, whitespace, empty query matches all) in `apps/cinefilo/src/lib/search.test.ts`; then `lib/search.ts` (D2).
- [x] 1.2 `listView` gains `filter`, `query`, `scroll` (D5); compact header, search field, order icons and Filter button + `FilterSheet.svelte` + active-filter chip (D1–D4). Playwright: search (match, accents, no match, clear, offline), the filter sheet (update `filters.spec.ts`), order icons (update `feedback.spec.ts`), header height scenario at 390×844, the partner list still shows "view only".
- [x] 1.3 Scroll kept (D5): Playwright with enough titles to scroll — scroll Watched, open a title (it starts at top), Back returns to the same `scrollY` (±2 px) with filter and query intact, in list and grid.

## 2. Sizes

- [x] 2.1 Smaller controls and the compact Ratings block (D6), both themes; existing size assertions (back 44 px, hero 200 px, recs ≥ 44 px, appearance ≥ 44 px) stay green; the partner review is still in view at 390×844.
- [x] 2.2 Screenshots (both themes) of Watched, the Filter sheet and the title screen to `e2e/cinefilo/__screens__/compact-*.png`.
