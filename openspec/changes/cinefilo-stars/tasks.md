# Tasks

Checks = `pnpm typecheck`, eslint, depcruise (the `lint` script's paths), `pnpm test`, `pnpm test:convergence`, `pnpm --filter cinefilo build`, the Cinéfilo e2e project (`cd e2e && npx playwright test --project=cinefilo --trace off`).

## 1. Core and db

- [x] 1.1 Tests first (core, no mocks): `parseStars`; `SetStars` (insert carries the key, edit, clear, rejects 0/11/2.5/"4", someone else's rating → `NotYourRating`); allow-list accepts `stars` 1–10/null and refuses others; `tierOf` returns `r` for ratings ops with `stars`, unchanged otherwise; export round-trips `stars` and reads files without it; reconcile carries `stars` (D1–D4). Then implement; remove `SetVerdict` and `filters.ts` with their tests.
- [x] 1.2 Tests first (db, in-memory SQLite): migration 3 (column, CHECK, cursor reset; v2 → v3 test), `ListItem.mine/partner` and `RatingView.stars` from `stars`, an old verdict alone reads as not rated, `list()` without a filter, io import/export of `stars`; convergence with an old-version peer that skips tier `r` (1,000 runs, `pnpm test:convergence`). Then implement (D1, D5).

## 2. UI

- [ ] 2.1 `Stars.svelte` (D6) and the stacked Ratings block; the worker protocol and `lib/commands.ts` use `SetStars`. Playwright: tap halves (3.5), drag to 5, keyboard arrows/Home/End/Delete, Clear, offline, partner read-only label, partner review in view at 390×844, both themes.
- [ ] 2.2 Lists (D7): row stars with labels, both-loved mark gone; Filter button, sheet, chip and `listView.filter` removed, with `filters.spec.ts` deleted and `compact-lists.spec.ts` / `seed.ts` updated (seeds rate with stars). Header height ≤ 200 px.
- [ ] 2.3 Screenshots (both themes): title screen with stars, Watched list, to `e2e/cinefilo/__screens__/stars-*.png`.
