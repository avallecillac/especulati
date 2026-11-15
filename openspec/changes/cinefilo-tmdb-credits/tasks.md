# Tasks

Checks = `pnpm typecheck`, eslint, depcruise (the `lint` script's paths), `pnpm test`, `pnpm test:convergence`, `pnpm --filter cinefilo build`, the Cinéfilo e2e project.

## 1. Core and db

- [ ] 1.1 Tests first (core, no mocks): D1 validation; `AddTitle`/`LinkToTmdb` fill the new fields only when empty; `FillTmdbCredits` (writes, `[]` for none, no-op when already fetched / no tmdb_id / deleted); `tierOf` `'c'` and the split of mixed `c`/`p` title ops (D3); allow-list; export round-trip and files without the keys. Then implement.
- [ ] 1.2 Tests first (db): migration 4 (columns, cursor reset; v3 → v4), `needsCredits`, `ListItem` and title detail carry the decoded fields, io; convergence with an old-version peer that skips tier `c` (`pnpm test:convergence`). Then implement.

## 2. App

- [ ] 2.1 TMDB client with credits (D4) and unit tests; Add and Link pass the new details; backfill second queue (D5).
- [ ] 2.2 Title screen details line (D6); search by people, genres and countries (D7) with the `matchesQuery` unit tests extended. Playwright with the TMDB fixtures: add shows the details; an already-linked title is backfilled; search "coppola" and a country; a title with no actress shows only the actor; both themes.
