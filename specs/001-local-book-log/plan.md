# Implementation Plan: Local Book Log

**Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `001-local-book-log`) | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-local-book-log/spec.md`

## Summary

This feature delivers the local-first foundation of Readerlog:

- An installable, offline PWA whose only store is SQLite-WASM persisted in OPFS
  (`opfs-sahpool`), running inside a dedicated worker.
- Books are added manually. Progress is logged as append-only events: pre-filled page,
  "Read today", Today/Yesterday, and a finish prompt.
- Status is derived from those events, and entries are undone by tombstoning them.

Every write goes through a pure `decide()` in `packages/core`. The worker applies the
result in one transaction that also writes `field_clock` and an HLC-stamped
`change_log`. Sync (feature 004) will ship that log unchanged.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), on Node 22 for tooling and tests.

**Primary Dependencies**:

- `@sqlite.org/sqlite-wasm` 3.53.4-build1
- Svelte 5.57, with `@sveltejs/vite-plugin-svelte` 7.3
- Vite 8.3
- vite-plugin-pwa 1.3 (Workbox 7)

See [research.md](research.md) for why each was chosen.

**Storage**: SQLite on OPFS (the `opfs-sahpool` VFS) in a Web Worker. Tests use
in-memory SQLite-WASM on Node.

**Testing**:

- Vitest 5: core with no mocks; db against in-memory SQLite-WASM.
- Playwright 1.56.1 on Chromium for e2e, offline, and two-tab scenarios.
- dependency-cruiser 18 and ESLint 10 enforce the core/shell boundary.

**Target Platform**: iOS 17+ Safari as an installed home-screen web app, and current
Chrome on macOS.

**Project Type**: Local-first web app (PWA) in a pnpm monorepo.

**Performance Goals**: A save is visible in under 100 ms. Cold start to an interactive
home card takes under 1.5 s on a mid-range iPhone.

**Constraints**:

- Fully offline after the first load.
- No server calls in this feature.
- No COOP/COEP headers are needed.
- Only one DB connection per device at a time, arbitrated with Web Locks.

**Scale/Scope**: One user, about 5 screens, about 100 books and 5,000 events per
decade.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Local-first | Every read and write happens in the worker's local DB. The feature makes no network calls. An offline e2e test is included (scenario 8). | PASS |
| II. User owns data | No data leaves the device. `change_log` is complete enough to export and replay (scenario 13). No analytics. | PASS |
| III. Events over state | Status and last page are derived. Events are insert-only except `deleted_at`, enforced by the commands contract (invariant 5). `local_date` is explicit and computed in the shell at save time. | PASS |
| IV. Functional core / imperative shell | `decide`, `deriveStatus`, `lastPage`, and `hlcNext` are pure. Time and IDs are injected. Core `tsconfig` has no DOM lib, lint bans `Date.now`/`Math.random`, and dependency-cruiser enforces the import rule. | PASS |
| V. Near-zero friction | Home card → Log → Save is 2 taps. Home card → Log → Read today is 2 taps. The page is pre-filled, Today is the default, and Yesterday is 1 tap. | PASS |
| VI. Simplicity | 3 workspace packages: core, db, and pwa. The db package has two real consumers today, the PWA worker and the Node test harness, and sync is its third. A hand-written hash router, no state or UI libraries, and each dependency is justified in research. | PASS |
| VII. Verified correctness | Unit tests, property tests (a reference model for status and last page), db invariant tests, and e2e tests for every user story. | PASS |
| Tech constraints | No paid Apple account required. Migration 1 is a forward-only `user_version` migration. The performance budget is measured in e2e (timing on save → visible). | PASS |

**Post-design re-check (after Phase 1):** PASS. The contracts add no new
dependencies or packages. `worker-api.md` keeps SQLite behind the worker, and
`db-schema.md` reserves the later-feature columns so no migration churn is needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-local-book-log/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── commands.md       # decide() + Command set + invariants
│   ├── db-schema.md      # migration 1 DDL + apply contract
│   ├── worker-api.md     # UI ↔ DB worker messages and read models
│   └── change-log.md     # change_log entry format (for 004/006)
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
package.json                 # pnpm workspace root: scripts typecheck/lint/test/e2e
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.js
.dependency-cruiser.cjs
.github/workflows/ci.yml

packages/core/               # PURE — no deps, no DOM, no clock/random
├── src/
│   ├── result.ts            # Result<T,E>
│   ├── types.ts             # branded ids, LocalDate, Page, NonEmptyTitle… + parsers
│   ├── hlc.ts               # hlcNext, compare
│   ├── book.ts              # eventOrder, deriveStatus, lastPage, lastActivity
│   ├── commands.ts          # Command, Rejection, Change, Decision types
│   ├── decide.ts            # decide()
│   └── index.ts
└── test/                    # decide, book derivations (+ property tests), hlc, parsers

packages/db/                 # SQLite-specific; runs in browser worker and Node
├── src/
│   ├── migrations.ts        # migration 1 (contracts/db-schema.md)
│   ├── apply.ts             # applyChanges: rows + field_clock + change_log + meta.hlc
│   ├── snapshot.ts          # loadBookSnapshot
│   ├── queries.ts           # home, library, book read models
│   └── index.ts             # openDb(sqlite3, vfsName?) → Db
└── test/                    # migrations, apply atomicity, change-log replay, queries

apps/pwa/
├── index.html
├── vite.config.ts           # svelte + VitePWA (generateSW, precache .wasm)
├── public/                  # icons, apple-touch-icon
└── src/
    ├── main.ts
    ├── App.svelte           # hash router
    ├── lib/
    │   ├── dbClient.ts      # typed postMessage RPC (contracts/worker-api.md)
    │   ├── clock.ts         # nowInstant, todayLocal, yesterdayLocal
    │   └── router.ts
    ├── worker/db.worker.ts  # Web Lock, sahpool VFS, pause/unpause, dispatch/query
    └── screens/             # Home.svelte, LogSheet.svelte, AddBook.svelte,
                             # Library.svelte, BookDetail.svelte, Settings.svelte

e2e/
├── playwright.config.ts     # chromium from /opt/pw-browsers, vite preview webServer
└── *.spec.ts                # scenarios from quickstart.md
```

**Structure Decision**: a pnpm monorepo with only the three packages this feature
needs: `packages/core`, `packages/db`, and `apps/pwa`, plus `e2e/`. `packages/sync`,
`apps/extension`, and `apps/relay` will be created by features 004 and 005 once they
have real code (Constitution VI).

## Complexity Tracking

No constitution violations. This section is intentionally empty.
