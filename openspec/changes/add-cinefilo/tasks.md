# Tasks

Prerequisite: `rename-to-lector` and `extract-shared-sync` are applied, and their checks are green.

## 1. Scaffold

- [x] 1.1 Create `packages/cinefilo-core`, `packages/cinefilo-db` and `apps/cinefilo` as Svelte 5 + Vite + `vite-plugin-pwa`. Give the DB worker its own OPFS file `/cinefilo.db`, the VFS name `cinefilo-sahpool` and the Web Lock `cinefilo-db`, and add the workspace packages. Verify that `pnpm install && pnpm typecheck` passes and that `pnpm --filter cinefilo dev` serves an empty shell.
- [x] 1.2 Add dependency-cruiser rules: no imports between `cinefilo-*` and lector packages, and `cinefilo-core` is pure, with no DOM lib, no other packages and no `Date.now`, `Math.random` or `fetch`. Verify that `pnpm lint` passes, and fails on a deliberate bad import that is then reverted.
- [x] 1.3 Add the cinefilo Pages Functions adapter, which mounts the shared relay handler on `CINEFILO_RELAY_DB`, plus build config for its own Pages project. Verify the relay handler tests pass against the adapter (`pnpm test --project relay`).
- [ ] 1.4 Create the Cloudflare Pages project `cinefilo` (Git-connected, root `apps/cinefilo`, build-watch paths limited to cinefilo and shared packages) and bind `CINEFILO_RELAY_DB` (production and preview) to the D1 database `cinefilo-relay`. Done: the project is `cinefilo`, served at `cinefilo-6oo.pages.dev` (`cinefilo.pages.dev` was taken) (already created, id `48d221be-1783-4866-b737-2e40265697f7`, relay `schema.sql` applied). Verify a preview deploy answers `GET /api/v1/…` with the relay's 401 for a missing token.

## 2. Core domain (`cinefilo-core`, tests first, no mocks)

- [ ] 2.1 Branded types and smart constructors: `TitleId`, `MemberId`, `RatingId`, `Kind`, `Status`, `Verdict`, `LocalDate`, `NonEmptyTitle`, `Review` (at most 1,000 characters, trimmed, empty → null) and `Season`. Verify with Vitest constructor tests, including the boundaries.
- [ ] 2.2 `titleKey()` normalization (NFKD, strip marks, lowercase, collapse spaces and punctuation), plus the label builders for the title and rating ids. Verify with tests for "Amélie" = "amelie", "Solaris 1972" ≠ "Solaris 2002", and movie ≠ series.
- [ ] 2.3 `decide()` for the catalog commands: `AddTitle` (including `AlreadyExists`), `EditTitleDetails`, `LinkToTmdb`, `RemoveTitle` and `RestoreTitle`. Verify with Vitest tests for each `cinefilo-catalog` scenario that core can observe.
- [ ] 2.4 `decide()` for `SetStatus` and `SetCurrentSeason`:
  - reject `watching` and `dropped` for movies;
  - check the season range;
  - set or clear `watched_on`, with status and date in one change.

  Verify with tests mirroring the `cinefilo-watchlist` scenarios.
- [ ] 2.5 `decide()` for `SetVerdict` and `SetReview`, including the `NotYourRating` rejection, and for `CreateMember`, `RenameMember` and `RemoveMember`. Verify with tests mirroring the `cinefilo-ratings` and `cinefilo-sharing` member scenarios.
- [ ] 2.6 A pure `ReconcileTitles` (design D4): pick the survivor, take each field by greater HLC, copy ratings per member by HLC, and set `merged_into`. Verify with tests showing determinism (same inputs → identical changes) and the "link would duplicate" scenario.
- [ ] 2.7 Pure verdict filters (both liked, disagree, only me, partner hasn't rated, nobody), plus the remote-op allow-list (tables, writable fields, id formats). Verify with tests, including the rejection of unknown tables and fields.
- [ ] 2.8 The `cinefilo/v1` export DTO, with parse and serialize. It rejects unknown versions, and the round trip is lossless. Verify with tests.

## 3. Storage (`cinefilo-db`, in-memory SQLite)

- [ ] 3.1 Migration 1 for the schema v1 tables (design D2) and the partial indexes, through the shared migration runner, plus a test that migrates an empty database to v1. Verify with `pnpm test --project cinefilo-db`.
- [ ] 3.2 Apply decisions and remote ops through the shared plumbing, all-or-nothing, with `field_clock` and `change_log` updated. Verify with tests that the transaction rolls back on a failing op and that the allow-list skips bad ops.
- [ ] 3.3 Read models: the three lists with their sort orders, the title detail with both ratings and member names, and the filters, all excluding `deleted_at` and `merged_into` rows. Verify with fixture database tests, including tombstones, merged rows and a removed title that has ratings.
- [ ] 3.4 A convergence test: 2 members on 3 devices, random command streams (adding the same titles offline, concurrent status, season and rating edits, remove versus rate, link plus reconcile), and delivery in random order with duplicates. Every database must end identical. Verify that `pnpm test:convergence` includes cinefilo and passes 1,000 runs.
- [ ] 3.5 Export and import against the database, with an idempotent merge by id that applies fully or not at all. Verify with tests for export → import into an empty database equals the original, and for importing twice being a no-op.

## 4. Sync wiring

- [ ] 4.1 Instantiate the shared engine in the cinefilo DB worker with salt `cinefilo-sync-v1`, AAD `cinefilo/v1/`, QR prefix `cinefilo:sync:1:`, the allow-list and the single-tier `tierOf`. Verify with a sync test over the in-memory relay: two databases converge, and the relay store holds only `{ batchId, iv, ct }`.
- [ ] 4.2 Run reconcile after each sync and after `AddTitle` and `LinkToTmdb`. Verify with a test: two devices, one adds the title by hand and the other from TMDB, and after sync and reconcile there is one live title with both ratings.
- [ ] 4.3 Redaction: the sync code, keys, token and TMDB key never appear in errors, logs or `meta` exports. Verify with a test that forces errors and greps their messages.

## 5. UI flows (Svelte, Playwright first)

- [ ] 5.1 The theme token file, the guard test against literal colours, and the app shell with the Watch later, Watching, Watched and Settings tabs. Verify that `pnpm test` (guard) and the Playwright smoke test of tab navigation pass.
- [ ] 5.2 Add by hand (title, kind, year, status) offline, with duplicate re-add opening the existing entry. Verify with a Playwright run in an offline context.
- [ ] 5.3 The title screen: status control, watched date (Today, Yesterday, a picker), season stepper, side-by-side ratings with 1-tap verdicts, review editing with the limit, the partner's column read-only, and remove with Undo. Verify with Playwright flows for the watchlist and ratings scenarios.
- [ ] 5.4 The filter chips on the lists. Verify with Playwright against a seeded database for each filter.

## 6. TMDB

- [ ] 6.1 A TMDB client for search/multi and movie and tv details, with the 8 s deadline and failure outcomes, tested against recorded fixtures, and no key in error text. Verify with Vitest using fixture responses.
- [ ] 6.2 Settings for the TMDB key, kept device-local, plus the attribution notice and logo in About. In the add sheet, search shows results with a 1-tap Add, and falls back to manual when there is no key, the device is offline or TMDB fails. Verify with Playwright using a mocked TMDB route, checking that adding takes at most 2 taps after the results appear.
- [ ] 6.3 The poster cache in the worker (downscale, local table, placeholder art) and Link to TMDB from the title screen. Verify with a Playwright test that a poster shows offline after the first fetch, and that linking keeps the ratings.

## 7. Sharing and pairing

- [ ] 7.1 First run: "Start a shared list" with the name creates the space and the member, and sets `member_id`. Showing the code gives text plus QR. Verify with Playwright.
- [ ] 7.2 Join by scanning or pasting the code (an invalid code is rejected), then "who am I" (an existing member, or "I'm new"), then the initial download. Verify with a two-context Playwright test against the local relay: the partner sees the full catalog, and both rate one title offline and then converge.
- [ ] 7.3 Rename a member, change "who am I" in Settings, the trust disclosure text, Leave (with confirmation and an export offer, erasing local data) and "start a new space" carrying the catalog over. Verify with Playwright: after a new space, the old-code device receives nothing new.
- [ ] 7.4 Export and import from Settings. Verify with a Playwright download and re-import into a fresh context that gives an equal catalog.

## 8. Integration and deploy

- [ ] 8.1 Make sure CI (typecheck, lint, unit tests) covers the cinefilo packages, and run cinefilo's e2e and convergence locally before merging (e2e is not run in GitHub Actions; see CLAUDE.md). Confirm lector's suites are untouched. Verify that the CI run is green and the local e2e passes.
- [ ] 8.2 Document cinefilo in `docs/` (architecture, deploy steps, pairing a partner, the TMDB key) and in the repository README. Verify that the documented deploy steps work against the preview project.
- [ ] 8.3 Production deploy and real pairing on both partners' phones. Verify by hand: a title added offline on one phone appears on the other, and both ratings show.

## Workflow follow-up

- Archive the change once it is deployed and reviewed (`openspec archive add-cinefilo`).
- A Google Keep import is a separate future change.
