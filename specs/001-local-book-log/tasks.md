---

description: "Task list for 001-local-book-log"
---

# Tasks: Local Book Log

**Input**: Design documents from `/specs/001-local-book-log/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (commands, db-schema, worker-api, change-log), quickstart.md

**Tests**: REQUIRED. Constitution VII says every change is test-backed at the lowest
level that can observe it. Write each test task before its implementation, and
confirm the test fails first.

**Organization**: Tasks are grouped by user story. Within priority P1, stories are
ordered by dependency: US2 (add a book) comes before US1 (log progress), because
logging needs a book to exist. US5 (offline/installable) follows them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel: different files, and no dependency on an incomplete task.
- **[Story]**: US1–US5, as in spec.md.
- Paths are relative to the repo root. The layout is defined in plan.md → Project
  Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the pnpm monorepo and toolchain with the pinned versions from
research.md R9.

- [X] T001 Create the workspace root.
  - `package.json`: `"private": true`, `"packageManager": "pnpm@10.33.0"`, `engines.node >=22`.
  - Scripts: `typecheck` = `pnpm -r typecheck`; `lint` = `eslint . && depcruise packages apps --config .dependency-cruiser.cjs`; `test` = `vitest run`; `e2e` = `playwright test -c e2e/playwright.config.ts`.
  - `pnpm-workspace.yaml` listing `packages/*`, `apps/*`, `e2e`.
  - `.gitignore`: node_modules, dist, test-results, playwright-report, `.vite`.
  - `.npmrc` with `auto-install-peers=true`.
- [X] T002 Create `tsconfig.base.json`.
  - Options: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `module`/`moduleResolution` `"Bundler"`, `target` `"ES2022"`.
  - Add root dev dependencies: `typescript@~5.9`, `vitest@^5.0.2`, `eslint@^10`, `typescript-eslint@^8.70`, `dependency-cruiser@^18.4`, `@playwright/test@1.56.1`.
- [X] T003 [P] Create `packages/core/package.json`.
  - Name `@readerlog/core`, `"type": "module"`, exports `./src/index.ts`, **no dependencies**.
  - `packages/core/tsconfig.json` extends the base with `"lib": ["ES2023"]` (no DOM) and `"types": []`, as in research R8.
  - Script `typecheck` = `tsc --noEmit`.
- [X] T004 [P] Create `packages/db/package.json`.
  - Name `@readerlog/db`.
  - Dependencies: `@readerlog/core: workspace:*`, `@sqlite.org/sqlite-wasm@3.53.4-build1`.
  - `packages/db/tsconfig.json` extends the base with `"lib": ["ES2023"]` and `"types": ["node"]` for tests only. Add `@types/node` as a dev dependency.
- [X] T005 [P] Create `apps/pwa/package.json`.
  - Name `pwa`.
  - Dependencies: `@readerlog/core`, `@readerlog/db` (both `workspace:*`), `@sqlite.org/sqlite-wasm@3.53.4-build1`.
  - Dev dependencies: `svelte@^5.57`, `@sveltejs/vite-plugin-svelte@^7.3`, `vite@^8.3`, `vite-plugin-pwa@^1.3`, `svelte-check@^4.7`, `workbox-window@^7.4`.
  - Scripts: `dev`, `build`, `preview`, and `typecheck` = `svelte-check`.
  - `apps/pwa/tsconfig.json` with DOM and WebWorker libs.
- [X] T006 [P] Create `e2e/package.json` and `e2e/playwright.config.ts`.
  - Chromium project with `launchOptions.executablePath` from `/opt/pw-browsers` when `PLAYWRIGHT_BROWSERS_PATH` is set.
  - `webServer` = `pnpm --filter pwa build && pnpm --filter pwa preview --port 4173`, with `baseURL` `http://localhost:4173`.
  - `use.serviceWorkers: 'allow'`.
  - `use.timezoneId: 'America/New_York'` and `use.locale: 'en-US'`, so local-date tests are deterministic and cross a UTC date boundary (research R6).
- [X] T007 [P] Create `vitest.config.ts` at the root: `projects: ['packages/core', 'packages/db']`, `environment: 'node'`.
- [X] T008 [P] Create `eslint.config.js` (flat config) with typescript-eslint recommended-type-checked.
  - For `packages/core/**`, add `no-restricted-properties` for `Date.now`, `Math.random`, and `crypto.randomUUID`.
  - Also add `no-restricted-globals` for `window`, `document`, `self`, `fetch`, `navigator`, `localStorage`, `indexedDB`, `setTimeout`, and `setInterval`.
- [X] T009 [P] Create `.dependency-cruiser.cjs` with these rules:
  - `core-is-pure`: `packages/core` MUST NOT depend on any path outside `packages/core/src`, and MUST NOT depend on any npm module.
  - `db-no-ui`: `packages/db` MUST NOT import `apps/`.
  - `no-circular`.
- [X] T010 [P] Create the `.github/workflows/ci.yml` job on ubuntu-latest with Node 22 and pnpm 10.
  - Steps: `pnpm install --frozen-lockfile`, then `typecheck`, `lint`, `test`.
  - Then `npx playwright install --with-deps chromium` and `e2e`.
- [X] T011 Run `pnpm install` to generate `pnpm-lock.yaml`. Verify `pnpm typecheck` and `pnpm lint` pass on the empty packages; add a placeholder `src/index.ts` to each.

**Checkpoint**: the toolchain is green, and the boundary check fails if you
temporarily add `import 'node:fs'` to core.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the pure core primitives, the DB layer with atomic apply, the worker RPC,
and the app shell. Every story needs these.

**⚠️ CRITICAL**: no user story work may start until this phase is complete.

### Tests first

- [X] T012 [P] Write parser tests in `packages/core/test/types.test.ts`. Accept and reject for every rule in the data-model.md table:
  - `NonEmptyTitle` "Trimmed, 1–500 characters"
  - `Author`/`Genre` "Trimmed, 1–200 characters; empty input → `null`"
  - `PageCount` "Integer, 1–100 000"
  - `Page` "Integer, 1–100 000"
  - `LocalDate` "`YYYY-MM-DD`, a real calendar date". Reject `2026-02-30`.
  - `Instant` "UTC ISO-8601 with `Z`"
  - `Hlc` `^\d{13}-\d{4}-<uuid>$`
- [X] T013 [P] Write HLC tests in `packages/core/test/hlc.test.ts`:
  - output is monotonic when the wall clock goes backwards or repeats;
  - the counter increments;
  - lexicographic order equals causal order;
  - the format is `%013d-%04d-<deviceId>`.
- [X] T014 [P] Write derivation tests in `packages/core/test/book.test.ts`:
  - `eventOrder` sorts by `(local_date, occurred_at, id)` and ignores `deleted_at` events;
  - `deriveStatus` follows the table: none → queued; started/progress → reading; finished → finished; abandoned → abandoned;
  - `lastPage` ignores NULL pages;
  - `lastActivity`.
- [X] T015 [P] Write DB migration tests in `packages/db/test/migrations.test.ts`:
  - a fresh DB reaches `user_version = 1` with every table and index in contracts/db-schema.md;
  - running `migrate` twice is a no-op;
  - the CHECK constraints reject a blank title, `total_pages = 0`, and a page on a non-progress event.
- [X] T016 [P] Write apply tests in `packages/db/test/apply.test.ts`, covering the four "Tested invariants" in contracts/db-schema.md:
  - the number of change_log rows added equals the number of changes;
  - `field_clock` matches each change's HLC;
  - HLCs strictly increase in `seq` order;
  - a failure injected after change k leaves an identical logical dump.

  Write a `dumpLogical(db)` test helper in `packages/db/test/helpers.ts`.
- [X] T017 [P] Write a replay test in `packages/db/test/replay.test.ts`: rebuild a fresh DB purely from `change_log` rows (LWW per field, in HLC order). Its logical dump must equal the source DB's dump (contracts/change-log.md, quickstart scenario 13).

### Implementation

- [X] T018 [P] Implement `packages/core/src/result.ts`: `Result<T,E>`, `ok()`, and `err()`.
- [X] T019 [P] Implement `packages/core/src/types.ts`: branded types and their parsers, each exactly as tested in T012.
- [X] T020 [P] Implement `packages/core/src/hlc.ts`: `hlcNext(prev: Hlc | null, wallMs: number, deviceId: DeviceId): Hlc` and `compareHlc`.
- [X] T021 Implement `packages/core/src/book.ts`: `eventOrder`, `deriveStatus`, `lastPage`, `lastActivity`, as in data-model.md "Derived values". Depends on T019.
- [X] T022 Define the types in `packages/core/src/commands.ts`, exactly as in contracts/commands.md:
  - `Command` union: `AddBook | EditBook | RemoveBook | LogEvent | RemoveEvent`
  - `Rejection` union: `TitleRequired | InvalidPageCount | InvalidPage | PageBeyondEnd | PageNotAllowed | PagesBelowLogged | InvalidTransition | NotFound | AlreadyExists`
  - `Change`, `Decision`, `BookSnapshot`

  Create `packages/core/src/decide.ts` exporting `decide(snapshot, cmd, now)`. At this stage every command returns `err({kind:'NotImplemented'})`, and the stories fill them in.
- [X] T023 Export the public API from `packages/core/src/index.ts`.
- [X] T024 Implement the migrations in `packages/db/src/migrations.ts`: migration 1, with the DDL copied verbatim from contracts/db-schema.md. `migrate(db)` runs pending migrations inside `BEGIN IMMEDIATE`, keyed on `PRAGMA user_version`, and runs `PRAGMA foreign_keys = ON` on open.
- [X] T025 Implement `packages/db/src/apply.ts`, following contracts/db-schema.md "Apply contract".
  - Signature: `applyChanges(db, changes, deviceId, wallMs: () => number, newOpId: () => string)`.
  - Clock and ID generators are injected so tests are deterministic.
  - Upsert only the given fields (`INSERT … ON CONFLICT(id) DO UPDATE SET` for exactly those fields).
  - Also write `field_clock`, `change_log`, and `meta.hlc`, all in one transaction.
- [X] T026 Implement `packages/db/src/snapshot.ts`: `loadBookSnapshot(db, itemId): BookSnapshot | null`, including tombstoned events.
- [X] T027 Implement `packages/db/src/index.ts`.
  - `openDb(sqlite3, filename, vfs?)` → `Db` exposing `migrate`, `dispatch(cmd, env)`, and `query(q)`.
  - `dispatch` = `BEGIN IMMEDIATE` → load snapshot → `decide` → `applyChanges` → `COMMIT` (or `ROLLBACK`). It returns `Result<{offerFinish}, Rejection>`.
  - Device identity: `ensureDeviceId(db, newId)` creates `meta.device_id` on first open.
- [X] T028 Create `packages/db/test/helpers.ts`: an in-memory `openTestDb()` using `sqlite3InitModule()` plus `oo1.DB(':memory:')`, a fixed clock, and sequential UUIDs.
- [X] T029 Implement `apps/pwa/src/lib/clock.ts`:
  - `nowInstant()`;
  - `todayLocal()` via `Intl.DateTimeFormat('en-CA', {timeZone})` → YYYY-MM-DD;
  - `yesterdayLocal()`, using calendar-day arithmetic rather than subtracting 24 h (research R6).
- [X] T030 Implement `apps/pwa/src/worker/db.worker.ts`, following contracts/worker-api.md and research R2.
  - Startup:
    1. Initialize `sqlite3InitModule()`.
    2. Acquire the Web Lock `readerlog-db`.
    3. Call `installOpfsSAHPoolVfs({name:'readerlog-sahpool'})`.
    4. Open `/readerlog.db`, then migrate and `ensureDeviceId`.
  - Handle `dispatch` and `query` messages.
  - Post `{type:'changed'}` on `BroadcastChannel('readerlog')` after each commit.
  - Pause and resume on `{type:'visibility', visible}` messages, calling `pauseVfs()`/`unpauseVfs()`.
  - Return `{kind:'Busy'}` if the lock isn't acquired within 5 s, and `{kind:'Storage'}` on I/O or quota errors.
- [X] T031 Implement `apps/pwa/src/lib/dbClient.ts`: a typed promise RPC over `postMessage`, following the `Request`/`Response` types in contracts/worker-api.md.
  - It forwards `visibilitychange` to the worker.
  - It exposes `onChanged(cb)` from the BroadcastChannel and from its own dispatches.
- [X] T032 [P] Implement `apps/pwa/src/lib/router.ts`: a hash router with routes `#/` (Home), `#/add`, `#/library`, `#/book/:id`, and `#/settings`, exposed as a Svelte 5 `$state`.
- [X] T033 Create the app shell.
  - `apps/pwa/index.html`, `apps/pwa/src/main.ts`, `apps/pwa/src/App.svelte`: header, bottom nav (Home · Library · Add · Settings), route outlet, and a toast region.
  - `apps/pwa/src/app.css`: CSS custom properties, light and dark themes, a 16px gutter, and 44px tap targets.
- [X] T034 Create `apps/pwa/vite.config.ts`.
  - Plugins: svelte and VitePWA (`registerType:'prompt'`, `generateSW`, `globPatterns` including `**/*.{js,css,html,wasm,svg,png}`).
  - Manifest: name "Readerlog", `display: standalone`, `start_url: './#/'`, icons 192/512.
  - Set `worker.format: 'es'` and `optimizeDeps.exclude: ['@sqlite.org/sqlite-wasm']`.
  - Add `apps/pwa/public/` icons and `apple-touch-icon.png`.

**Checkpoint**: `pnpm test` passes T012–T017. The PWA builds, opens on an empty Home
with "No book in progress", and the worker reports `schemaVersion 1` through a
`storage` query.

---

## Phase 3: User Story 2 - Add a book manually and start reading (Priority: P1)

**Goal**: add a book with a title and optional author, total pages, and genre. It can
optionally start reading immediately.

**Independent Test**: on an empty install, add a book with "Start reading now". It
appears as the current book on Home, with status Reading.

### Tests for User Story 2

- [X] T035 [P] [US2] Write core tests in `packages/core/test/decide.addBook.test.ts`:
  - `AddBook` with only a title emits 1 item change: all non-null fields, `type:'book'`, `created_at = now`.
  - `startNow` also emits a `started` event with `local_date = cmd.localDate` and `occurred_at = now`.
  - Rejects `TitleRequired` for a blank or whitespace title, and `InvalidPageCount` for 0, negative, or non-integer values.
  - `AlreadyExists` when the snapshot is non-null.
- [X] T036 [P] [US2] Write e2e tests in `e2e/add-book.spec.ts`, covering quickstart scenarios 1–3:
  - a title only gives Queued;
  - "Start reading now" puts the book on the Home card;
  - a blank title and pages = 0 show inline errors, and nothing is stored.

### Implementation for User Story 2

- [X] T037 [US2] Implement `AddBook` in `packages/core/src/decide.ts`. Parse every field through the T019 parsers.
- [X] T038 [US2] Implement the `home` query in `packages/db/src/queries.ts`: `HomeView { current?: BookCard; otherReading: BookCard[] }`.
  - `current` is the `reading` book with the greatest `lastActivity`.
  - Status is derived with core `deriveStatus` over the snapshot events, never stored.
- [X] T039 [US2] Create `apps/pwa/src/screens/AddBook.svelte`.
  - Fields: title (required), author, total pages (number input), genre, and a "Start reading now" toggle that defaults on.
  - Show inline error messages mapped from the `Rejection` kinds.
  - On success, navigate to `#/`.
- [X] T040 [US2] Create `apps/pwa/src/screens/Home.svelte`. It shows the current-book card (title, author, "p. N" / total), or an empty state with an "Add a book" button. It refreshes on `onChanged`.

**Checkpoint**: US2 works on its own, and T035 and T036 pass.

---

## Phase 4: User Story 1 - Log progress on the book I'm reading (Priority: P1) 🎯 MVP

**Goal**: log progress from the Home card in at most 2 taps: pre-filled last page,
Read today, Today/Yesterday, and a finish prompt.

**Independent Test**: seed a book that is being read, go offline, and log a page and a
"read today". Both appear under today's date.

### Tests for User Story 1

- [X] T041 [P] [US1] Write core tests in `packages/core/test/decide.logEvent.test.ts`. `LogEvent` progress with a page:
  - emits one event insert with all fields;
  - rejects a page that is not an integer or ≤ 0 with `InvalidPage`, and a page > `total_pages` with `PageBeyondEnd`;
  - accepts a page lower than `lastPage`;
  - sets `offerFinish = true` only when `page === total_pages`.

  Other cases:
  - progress without a page is accepted;
  - a page on started, finished, or abandoned gives `PageNotAllowed`;
  - progress on queued is allowed and results in reading;
  - finished or abandoned when the book isn't reading gives `InvalidTransition`;
  - `NotFound` for a null or removed item.
- [X] T042 [P] [US1] Write property tests in `packages/core/test/decide.property.test.ts`. Run 1,000 random sequences of AddBook, LogEvent, and RemoveEvent with a seeded PRNG in the test. Apply the changes to an in-memory snapshot, then compare `deriveStatus` and `lastPage` with a naive reference model (SC-005). Also check commands.md invariants 1, 2, and 5.
- [X] T043 [P] [US1] Write e2e tests in `e2e/log-progress.spec.ts`, covering quickstart scenarios 4–7:
  - the log sheet is pre-filled with 120, and saving 145 updates the card;
  - Read today;
  - Yesterday, with `page.clock` set to 2026-03-09T00:05 America/New_York (the day after the DST change), gives `2026-03-08`, and Today gives `2026-03-09`;
  - saving at `total_pages` prompts "Mark as finished?". Confirming marks the book Finished; declining leaves it Reading.
  - Assert that a save → visible card update takes under 100 ms (SC-002).
  - SC-001: from a cold `page.goto('/')`, reach a saved entry using exactly 2 clicks (Log, Save) plus one `fill` of the page input. Assert the elapsed time is < 5 s, and count the clicks with a helper that wraps `page.click`.
  - A book with unknown total pages can be finished from the log sheet's **Finish** action.

### Implementation for User Story 1

- [X] T044 [US1] Implement `LogEvent` in `packages/core/src/decide.ts`, following the contracts/commands.md table and the data-model.md state transitions.
- [X] T045 [US1] Create `apps/pwa/src/screens/LogSheet.svelte`, a bottom sheet.
  - The page input is pre-filled from `lastPage`, with ± steppers.
  - A date chip toggle: **Today** (default) / **Yesterday**. The date is computed at save time through `clock.ts`.
  - A primary **Save** button and a secondary **Read today** button (dispatches `progress` with no page).
  - Inline rejection messages.
  - A tertiary **Finish** action (dispatches `LogEvent finished`), so books with unknown total pages can be finished before US3 exists.
  - When `offerFinish` is returned, show a "Mark as finished?" confirm that dispatches `LogEvent finished`.
- [X] T046 [US1] Wire the Home card's **Log** button to open LogSheet. This makes Home → Log → Save and Home → Log → Read today 2 taps each (FR-008). Show a "Saved" toast with an Undo button (the handler is completed in US4).

**Checkpoint**: MVP. You can add a book and log progress. T041–T043 pass.

---

## Phase 5: User Story 5 - Install and use it like an app, offline (Priority: P1)

**Goal**: installable and full-screen, works completely offline after the first load,
data persists, and persistent storage is requested.

**Independent Test**: load once, go offline, reload. The app starts and shows all the
data.

### Tests for User Story 5

- [X] T047 [P] [US5] Write e2e tests in `e2e/offline.spec.ts`, covering quickstart scenarios 8–9:
  - load, wait for `navigator.serviceWorker.ready`, `context.setOffline(true)`, reload, then run the add + log + Read today flow;
  - close the page, open a new one in the same persistent context, and the data is still there.
- [X] T048 [P] [US5] Write e2e tests in `e2e/settings.spec.ts`: Settings shows the storage persistence state and the device ID.

### Implementation for User Story 5

- [X] T049 [US5] Call `navigator.storage.persist()` on first start from `apps/pwa/src/main.ts`, and store the result in the worker's `meta.storage_persisted`. Implement the `storage` query in `apps/pwa/src/worker/db.worker.ts`: `{ persisted, deviceId, schemaVersion }`.
- [X] T050 [US5] Create `apps/pwa/src/screens/Settings.svelte`.
  - Show "Storage: persistent" or a non-blocking notice when it isn't granted.
  - Show the device ID and schema version.
  - Show an "Update available → Reload" banner from `virtual:pwa-register` `onNeedRefresh`.
- [X] T051 [US5] Verify the production build precaches the sqlite `.wasm` file: check `dist/sw.js` for `sqlite3.wasm`. Add iOS meta tags to `apps/pwa/index.html`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `theme-color`. In `e2e/offline.spec.ts`, assert that `/manifest.webmanifest` parses and has `display: "standalone"` and 192/512 icons (FR-012).

**Checkpoint**: all P1 stories are complete. T047 and T048 pass.

---

## Phase 6: User Story 3 - See my library and each book's history (Priority: P2)

**Goal**: a library grouped by derived status, and a book detail screen with its
history and actions: start, log, finish, abandon, re-read, and edit.

**Independent Test**: seed books in each status. The grouping is correct, and each
book's history is listed newest first.

### Tests for User Story 3

- [X] T052 [P] [US3] Write core tests in `packages/core/test/decide.editRemoveBook.test.ts`:
  - `EditBook` emits only the fields that changed (an unchanged value emits nothing);
  - it rejects `PagesBelowLogged` when `totalPages` < the max logged page;
  - `RemoveBook` sets `deleted_at`, and removing an already-removed book emits zero changes.
- [X] T053 [P] [US3] Write DB tests in `packages/db/test/queries.test.ts`:
  - `library` lists each non-removed book exactly once, in the group for its derived status, with Reading ordered by `lastActivity` descending (FR-015);
  - `book` returns non-deleted events newest first;
  - removed books are absent from all views (FR-016).
- [X] T054 [P] [US3] Write e2e tests in `e2e/library.spec.ts`, covering quickstart scenario 11: Start moves a book to Reading; Abandon (with confirmation) moves it to Abandoned; logging on a Finished book moves it back to Reading; with two reading books, Home shows the most recent.

### Implementation for User Story 3

- [X] T055 [US3] Implement `EditBook` and `RemoveBook` in `packages/core/src/decide.ts`.
- [X] T056 [US3] Implement the `library` and `book` queries in `packages/db/src/queries.ts`, following the `LibraryView` and `BookView` read models in contracts/worker-api.md.
- [X] T057 [P] [US3] Create `apps/pwa/src/screens/Library.svelte`: four sections (Reading, Queued, Finished, Abandoned), with counts; tapping a book goes to `#/book/:id`.
- [X] T058 [US3] Create `apps/pwa/src/screens/BookDetail.svelte`:
  - the book card and its history list (date, type, page);
  - actions that depend on status: Start, Log (opens LogSheet), Finish, Abandon (with a confirmation), and Edit (reuses the AddBook form in edit mode);
  - Remove book (with a confirmation).
- [X] T059 [US3] Show "other reading books" on Home as one-tap chips that switch which book the log card targets.

**Checkpoint**: US3 works on its own. T052–T054 pass.

---

## Phase 7: User Story 4 - Undo a mistaken entry (Priority: P2)

**Goal**: remove a wrong entry, either through the toast's Undo or from the history.
The entry is tombstoned rather than erased, and derived values are recalculated.

**Independent Test**: log page 500 by mistake, then remove it. The last page reverts,
and the reading day disappears if that was the only entry that day.

### Tests for User Story 4

- [X] T060 [P] [US4] Write core tests in `packages/core/test/decide.removeEvent.test.ts`:
  - `RemoveEvent` emits exactly one change, `{deleted_at: now}`, on `reading_events`;
  - removing an already-removed event emits zero changes;
  - removing the only `started` event returns the book to queued;
  - an unknown event ID gives `NotFound`.
- [X] T061 [P] [US4] Write e2e tests in `e2e/undo.spec.ts`, covering quickstart scenario 10:
  - toast Undo;
  - removing an older entry from history recomputes the status and last page;
  - the removed row still exists in the DB with `deleted_at` set. This is checked at the DB level in `packages/db/test/tombstone.test.ts` rather than through a test-only worker query, which keeps the worker API to what the contract lists.

### Implementation for User Story 4

- [X] T062 [US4] Implement `RemoveEvent` in `packages/core/src/decide.ts`.
- [X] T063 [US4] Wire the toast Undo button (from T046) to dispatch `RemoveEvent` for the event just created. Add a swipe or "Remove" action with a confirmation to each history row in `apps/pwa/src/screens/BookDetail.svelte`.

**Checkpoint**: all user stories are complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T064 [P] Write two-tab e2e tests in `e2e/two-tabs.spec.ts`, covering quickstart scenario 12: write in tab A, focus tab B, and B shows the write. Also, the worker hands the Web Lock over when a tab is hidden.
- [ ] T065 [P] Write a storage-failure test in `packages/db/test/apply.test.ts`: simulate an SQLITE_FULL error. `dispatch` must return an error and leave the logical dump unchanged. Map the error to `{kind:'Storage'}` in `apps/pwa/src/worker/db.worker.ts`, and show it as a toast.
- [ ] T065a [P] Write e2e tests in `e2e/timezone.spec.ts` for the spec edge case "Time zone change while travelling".
  - In a context with `timezoneId: 'America/New_York'` and the clock at 2026-06-01T22:00 local, log progress. It is stored with `local_date = 2026-06-01`.
  - Reopen the same storage in a context with `timezoneId: 'Asia/Tokyo'` (clock unchanged, now 2026-06-02 11:00 local).
  - The first entry still shows 2026-06-01, and a new entry is stored as 2026-06-02.
- [ ] T066 [P] Write a performance check in `e2e/perf.spec.ts`: seed 100 books and 5,000 events through dispatch.
  - The Home query and a save → visible update must each take under 100 ms in Chromium (SC-002).
  - Cold start: from `navigationStart` to the Home card becoming visible (marked with `performance.mark('home-visible')` in `Home.svelte`) must take < 1.5 s on the production build (plan.md Performance Goals). Record the iPhone number manually in quickstart.md.
- [ ] T067 [P] Add a `CLAUDE.md` at the repo root. It should describe the commands (`pnpm test|lint|typecheck|e2e`), the core/shell rules, the spec-kit workflow, and the pinned versions (TypeScript 5.9, Playwright 1.56.1).
- [ ] T068 Run every quickstart.md validation command. Confirm that CI is green. Tick the completed scenarios in `specs/001-local-book-log/quickstart.md`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)** has no dependencies.
- **Foundational (2)** depends on Setup, and blocks all stories.
- **US2 (3)** depends on Foundational.
- **US1 (4)** depends on US2. It needs AddBook to create a book, and Home. Its core tests (T041, T042) can start as soon as Phase 2 is done.
- **US5 (5)** depends on Foundational plus a basic UI flow. Its e2e tests exercise the US2 and US1 flows, so do it after Phase 4.
- **US3 (6)** depends on Foundational. Its core and DB work is independent of US1 and US2. Its e2e tests use the add and log flows.
- **US4 (7)** depends on US1 (the toast) and US3 (the history list).
- **Polish (8)** comes after all stories.

### Within each story

Tests first, and confirm they fail. Then core `decide` → db queries → Svelte screens
→ wiring.

### Parallel opportunities

- Setup: T003–T010 all touch different files.
- Foundational tests: T012–T017 in parallel. Implementation: T018, T019, T020, and T032 in parallel.
- US1: T041, T042, and T043 in parallel.
- US3: T052, T053, and T054 in parallel. T057 runs in parallel with T055 and T056.
- US4: T060 and T061 in parallel.
- Polish: T064–T067 (including T065a) in parallel.

## Parallel Example: User Story 1

```bash
Task: "T041 core LogEvent tests in packages/core/test/decide.logEvent.test.ts"
Task: "T042 property tests in packages/core/test/decide.property.test.ts"
Task: "T043 e2e log-progress in e2e/log-progress.spec.ts"
```

## Implementation Strategy

### MVP first

1. Phase 1 (Setup), then Phase 2 (Foundational).
2. Phase 3 (US2, add a book), then Phase 4 (US1, log progress). **Stop and validate:**
   you can add a book and log progress daily.
3. Phase 5 (US5, offline and install). This is the first version worth installing on
   the iPhone.

### Incremental delivery

4. Add US3 (library and history), then US4 (undo), then Polish.
5. Commit at every checkpoint. Each commit is bisectable, as the constitution requires.
