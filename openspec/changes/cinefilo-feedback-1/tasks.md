# Tasks

Checks = `pnpm typecheck`, eslint, depcruise, `pnpm test`, `pnpm test:convergence`, `pnpm --filter cinefilo build`, `pnpm e2e`. Work on branch `personal-lists`; do not merge to `main`.

## 1. History order

- [x] 1.1 Tests first: `watch_order` in the allow-list, tier `p` (D3), migration 2 column (update the v1→v2 migration test), the D1 rank (ties, nulls last, renumbering after leaving Watched), D2 assignment in `decide()`, convergence with concurrent marks (1,000 runs).
- [x] 1.2 Titles file `watchOrder` (parse rules in D4) and `importTitles` setting it on existing titles; preview `ordersToSet`; idempotence test.
- [x] 1.3 Watched list `#N` and the "Newest first / From #1" toggle (D5), Playwright.

## 2. Reviews and layout

- [x] 2.1 Title screen order: Ratings before Lists (D5); review mark in rows. Playwright: partner review visible without scrolling at 390×844; mark labelled correctly.
- [x] 2.2 List/grid toggle and grid view (D5) in both themes; Playwright: grid persists across reload and lists, tiles open titles, no-poster tile shows the generated cover.
- [x] 2.3 Screenshots (both themes): watched list with numbers, grid, title screen top, to `e2e/cinefilo/__screens__/feedback-*.png`.

## 3. The corrected history (main session)

- [x] 3.1 keep-import build emits `watchOrder` (D6) with tests; build `import/titles.json` with *Triangle of Sadness* as #1.
- [ ] 3.2 Preview build; the user imports the file on one phone after the release.
