# Tasks

Checks = `pnpm typecheck`, eslint, depcruise, `pnpm test`, `pnpm --filter cinefilo build`; group 2 also `pnpm e2e`.

## 1. Core and storage

- [x] 1.1 Tests first: `statusFields` accepts watched without a date (writes `watched_on: null`), still rejects dropped without one; the convergence test still passes.
- [x] 1.2 `parseTitlesFile` (D2) with strict tests (wrong format, bad kind/status, watching on a movie, duplicates inside the file).
- [x] 1.3 `CinefiloDb.importTitles(file, env, { dryRun })` (D3): preview counts, one transaction, idempotent, 300-title performance test; derived id equals a TMDB search add.

## 2. App

- [x] 2.1 Worker protocol + Settings → Import list: file picker, preview (new / already there / invalid), confirm, result toast. Playwright: import, preview, cancel, re-import adds 0, partner receives via sync.
- [x] 2.2 TitleScreen "Watched · date unknown" + "Add date"; list ordering for undated watched (D1). Playwright.
- [x] 2.3 Background detail/poster fill for imported TMDB titles, throttled, only with a key. Test with the mocked TMDB route.

## 3. Local tool (`scripts/keep-import`)

- [x] 3.1 `parse` with tests on fixtures covering every pattern in design Context (no real data in fixtures).
- [x] 3.2 `match` and `review.md` with recorded TMDB fixtures; scoring and threshold tests.
- [x] 3.3 `build` → `import/titles.json`, validated by `parseTitlesFile`.

## 4. Run it

- [x] 4.1 (Main session) Run parse + match on the real list with the user's `TMDB_API_KEY`, go through `review.md` with the user, record `decisions.json`, build `titles.json`.
- [x] 4.2 (User) Import `titles.json` on one phone from Settings → Import list; check the partner's phone receives it.
