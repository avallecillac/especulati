# Research: Local Book Log (001)

Each entry is written as Decision / Rationale / Alternatives. The versions listed were
checked against the npm registry on 2026-09-27.

## R1. On-device database

- **Decision**: `@sqlite.org/sqlite-wasm` **3.53.4-build1** with the **`opfs-sahpool`**
  VFS, running in a dedicated Web Worker.
- **Rationale**:
  - It is real SQLite, so the stats SQL from `docs/architecture.md` §9 works unchanged.
  - It works in all major browsers released since March 2023, including Safari 16.4+
    and installed iOS web apps.
  - It needs **no COOP/COEP headers**.
  - It was verified to run in-memory under Node 22 (`sqlite3.oo1.DB(':memory:')`), so
    unit tests exercise the same engine the browser uses.
- **Alternatives considered**:
  - The plain `opfs` VFS: needs COOP/COEP and SharedArrayBuffer, and is flaky on
    Safari < 17.
  - IndexedDB with a JS query layer: would mean hand-writing every stat.
  - `wa-sqlite`: a capable community build, but the official build is simpler to
    trust for long-term data.
  - `better-sqlite3` for tests: a different engine build from the one that ships,
    which risks test-only passes.

## R2. Multiple tabs and windows on one device

- **Decision**: one DB owner at a time, arbitrated by the **Web Locks API**.
  - Each tab's worker requests the exclusive lock `readerlog-db`.
  - When a tab becomes hidden, it calls `PoolUtil.pauseVfs()` and releases the lock.
  - When a tab becomes visible, it re-requests the lock and calls `unpauseVfs()`.
  - After each commit, a `BroadcastChannel('readerlog')` message tells other tabs to
    refresh when they regain focus.
- **Rationale**: `opfs-sahpool` "does not support multiple simultaneous connections".
  The pause/unpause API (since 3.50) is the documented cooperative workaround. The
  spec's edge case only requires that writes show up when the other tab regains focus.
- **Alternatives considered**:
  - A SharedWorker owning the DB: SharedWorker support in iOS installed web apps has
    historically been unreliable, and it adds lifecycle complexity.
  - A leader-election RPC between tabs: over-engineered for a single user.

## R3. UI framework and build

- **Decision**: **Svelte 5.57** (runes) + **Vite 8.3** + `@sveltejs/vite-plugin-svelte`
  7.3. Routing is a ~30-line hash router written in-house. Styling is plain CSS with
  custom properties.
- **Rationale**: small bundles and fast startup on the phone, and reactive state
  without a store library. Five screens don't justify a router dependency
  (Constitution VI).
- **Alternatives considered**:
  - React: more runtime weight.
  - SvelteKit: file-based routing and SSR machinery that a static offline PWA doesn't
    need.
  - Preact/Solid: fine choices, but Svelte was preferred for readability.

## R4. Offline and installability

- **Decision**: **`vite-plugin-pwa` 1.3** in `generateSW` mode (Workbox 7).
  - Everything is precached, including the `.wasm` file.
  - It ships a web manifest with `display: standalone` and an apple-touch-icon.
  - Updates use `registerType: 'prompt'`: the app shows "Update available" and never
    reloads by itself mid-log.
- **Rationale**: a proven way to get a service worker, manifest, and update handling
  with little configuration.
- **Alternatives considered**: a hand-written service worker, which would mean
  re-implementing precache manifests and cache busting.

## R5. Storage persistence

- **Decision**: call `navigator.storage.persist()` on first run, and show the result
  (`navigator.storage.persisted()`) in Settings.
- **Rationale**: FR-013. Home-screen web apps on iOS are exempt from Safari's 7-day
  eviction of script-writable storage. `persist()` adds protection against eviction
  under storage pressure. Exports (feature 006) and sync (feature 004) are the real
  backup.
- **Alternatives considered**: none. This is the platform's only mechanism.

## R6. IDs, time, and "local date"

- **Decision**:
  - IDs are `crypto.randomUUID()` (v4), generated in the shell and carried in the
    command.
  - `occurred_at` is `new Date().toISOString()`, taken in the shell.
  - `local_date` is computed in the shell with
    `Intl.DateTimeFormat('en-CA', {timeZone: <resolved>})`, which gives YYYY-MM-DD.
    "Yesterday" is computed as the calendar day before, not "minus 24 hours".
- **Rationale**: this keeps the core pure (Constitution IV). Using calendar
  arithmetic avoids daylight-saving bugs. The date is evaluated at save time, which
  handles the midnight-crossing edge case.
- **Alternatives considered**: UUIDv7 for sortable IDs. Rejected because ordering
  comes from `local_date`/`occurred_at`/HLC, never from IDs.

## R7. HLC and change log (sync groundwork required by FR-011)

- **Decision**: the core provides a pure HLC:
  - `hlcNext(prev, wallMs, deviceId) → Hlc`
  - string form `%013d-%04d-<deviceId>`
  - `hlcNext` advances the counter whenever `wallMs <= prev.ms`, so stamps stay
    monotonic even if the clock goes backwards.

  The shell's apply step, inside the same transaction:
  1. stamps each change,
  2. upserts the rows,
  3. upserts `field_clock` per field,
  4. appends one `change_log` row per change,
  5. persists the latest HLC in `meta`.
- **Rationale**: feature 004 can ship `change_log` rows as they are. Local writes
  never lose to themselves.
- **Alternatives considered**:
  - Adding the change log only in feature 004: this would need a backfill and
    migration later.
  - Wall-clock timestamps only: not monotonic, so ties and clock skew break
    last-writer-wins.

## R8. Core/shell boundary enforcement

- **Decision**:
  - `packages/core/tsconfig.json` sets `"lib": ["ES2023"]` with **no DOM** and
    `"types": []`, so any browser or Node global fails the typecheck.
  - ESLint `no-restricted-properties` bans `Date.now`, `Math.random`, and
    `crypto.randomUUID` in core.
  - A **dependency-cruiser 18** rule forbids `packages/core` from importing any other
    workspace package or any npm dependency.
- **Rationale**: Constitution IV requires mechanical enforcement. Typecheck plus lint
  plus a dependency graph check catch globals, impure calls, and imports respectively.
- **Alternatives considered**: code review only, which is not mechanical.

## R9. Toolchain versions

- **Decision**:
  - Node 22 and pnpm 10 (workspaces).
  - **TypeScript 5.9.x**. It is pinned because typescript-eslint 8.70 supports
    TypeScript `<6.1`, and the new TypeScript 7 native compiler is not supported yet.
  - ESLint 10 + typescript-eslint 8.70.
  - Vitest 5.0.
  - **Playwright 1.56.1**. It is pinned to match the Chromium build preinstalled in
    the dev container (`chromium-1194`).
  - svelte-check 4.7.
- **Rationale**: every tool must work together today. The Playwright pin avoids
  downloading browsers.
- **Alternatives considered**: floating to latest, which breaks the lint and e2e
  toolchains.

## R10. Testing strategy for this feature

- **Decision**:
  - `packages/core`: Vitest with no mocks. Covers `decide`, `deriveStatus`,
    `lastPage`, validators, and HLC. Includes property-style tests: random command
    sequences checked against a simple reference implementation of status and last
    page (SC-005).
  - `packages/db`: Vitest on Node with in-memory SQLite-WASM. Covers migrations,
    apply atomicity (injecting a failure mid-transaction leaves no change, FR-010),
    change-log completeness, and queries.
  - `e2e/`: Playwright on Chromium.
    - A test that starts from a fresh load, then sets `context.setOffline(true)`,
      reloads, and runs a full log flow (SC-003).
    - A persistence-across-reload test.
    - A two-tab test.
- **Rationale**: tests happen at the lowest level that can observe each behavior
  (Constitution VII).
- **Alternatives considered**: WebKit in Playwright. It is not preinstalled in the
  container, so iOS is verified manually through the quickstart.

## R11. Where `decide` runs

- **Decision**: inside the **DB worker**. The UI posts a `Command`. The worker then:
  1. opens a transaction;
  2. loads a `BookSnapshot` (the item plus its events);
  3. calls `decide`;
  4. applies the resulting changes;
  5. commits, and replies with the outcome.
- **Rationale**: read, decide, and write happen in one transaction, so there are no
  stale-state races between tabs or with sync later.
- **Alternatives considered**: running `decide` in the UI thread, which risks
  deciding on stale state.

All Technical Context unknowns are resolved. None remain as NEEDS CLARIFICATION.
