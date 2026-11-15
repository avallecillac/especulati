# Tasks

Checks = `pnpm typecheck`, eslint, depcruise (the `lint` script's paths), `pnpm test`, `pnpm --filter cinefilo build`, the Cinéfilo e2e project.

## 1. Members

- [x] 1.1 Tests first (db, in-memory SQLite): `memberActivity()` counts (D1, deleted/merged excluded), `me()` null for a removed member (D3). Then implement, with the worker protocol and `dbClient`.
- [x] 1.2 Settings counts, Remove + confirm (D2); "Who are you?" after removal (D3); waiting for the first sync and the same-name question (D4). Playwright: two devices, a duplicate member with no activity is removed from one device and disappears on the other; a device acting as a removed member is asked who it is; no Remove for this device; the same-name question.
