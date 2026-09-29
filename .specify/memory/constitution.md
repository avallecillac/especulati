# Readerlog Constitution

## Core Principles

### I. Local-First (NON-NEGOTIABLE)

- Every device keeps a complete SQLite database. That database is the source of truth
  for everything the user sees on that device.
- Every read and write MUST complete locally, with no network round-trip, and MUST work
  in airplane mode.
- Network calls (book metadata lookup, sync) MUST be optional and asynchronous, and a
  failure MUST NOT be fatal. A failure leaves local data intact and retryable. It is
  never a blocking error.
- No feature may require the relay or any third-party API to be reachable in order to
  record reading.

Rationale: logging only works if it is always possible. Stats are only as good as the
completeness of the log.

### II. The User Owns the Data

- Every entity in the database MUST round-trip losslessly through the versioned
  `readerlog/vN` export. An import MUST merge by `id`, MUST be idempotent, and MUST
  either succeed completely or change nothing.
- Anything that leaves a device for the relay MUST be end-to-end encrypted with a key
  that only the user's devices hold. The relay MUST NOT be able to read titles, URLs,
  dates, or any other domain data.
- No analytics, tracking, or third-party SDKs.
- Article text MUST NOT be stored anywhere. Only derived metadata (title, author,
  domain, word count) is kept.

Rationale: the data is personal and meant to last for decades. Any server or vendor
may disappear; the user's export must not.

### III. Events Over State for Books

- Book progress MUST be recorded as append-only `reading_events`.
- Book status is derived from the latest non-deleted event and MUST NOT be stored.
- A correction MUST tombstone the wrong event and insert a replacement. Events are
  never updated in place.
- Every event MUST carry an explicit `local_date`, the calendar day as the user
  experienced it. It MUST NOT be derived from UTC at query time.
- Articles never create events and MUST NOT count toward reading days or streaks.

Rationale: historical stats (reading days, streaks, pace) stay computable and correct
after edits, after backdating, and when events sync in from other devices.

### IV. Functional Core, Imperative Shell (NON-NEGOTIABLE)

- `packages/core` MUST be pure. It MUST NOT use the DOM, SQLite, `fetch`, timers,
  `Date.now()`, or randomness, and MUST NOT import from any shell package.
- The shell passes in the current time and freshly generated IDs.
- Every mutation MUST flow through
  `decide(state, command, now) → Result<Change[], Rejection>`. The shell generates
  any new IDs and puts them inside the command, so a command can be replayed
  idempotently. The resulting
  changes MUST be applied in a single SQLite transaction that also writes
  `field_clock` and `change_log`. Partial application is a bug.
- **Exception: remote changes.** Changes merged from other devices by the sync rules
  (per-field last-writer-wins on HLC plus a union of events, Principle VI) are exempt
  from `decide()`, because they were already validated on the device that made them.
  - Re-deciding them against a different local state could reject them and break
    convergence.
  - They MUST still be applied all-or-nothing, in a single SQLite transaction.
  - They MUST update `field_clock` and be recorded in `change_log`.
  - They MUST pass a pure allow-list check (known table, writable field, well-formed
    ids and clock) before they are applied. A change that fails it MUST be skipped,
    not partially applied.
- Inputs MUST be parsed into branded types (`ItemId`, `LocalDate`, `Page`, and so on)
  at the boundary. Illegal states SHOULD be unrepresentable in the type system.
- CI MUST enforce the core/shell boundary mechanically.

Rationale: pure decision logic can be tested without mocks, and sync, import, and UI
all share a single write path.

### V. Near-Zero Logging Friction

- Each primary capture flow MUST take no more than 2 taps or clicks from its entry
  point. The flows are: logging book progress, "read today", logging an article from
  the Mac, and logging an article from the iPhone.
- Defaults MUST do the likely thing: the last page is pre-filled, today's date is
  pre-selected, and "Yesterday" is one tap away.
- A feature that adds a step to a primary capture flow MUST justify that step in its
  plan's Constitution Check.

Rationale: data completeness depends on how easy it is to log.

### VI. Simplicity (KISS / YAGNI)

- Build what the current feature spec needs, and nothing more.
- An abstraction MUST be justified by at least two real, present call sites.
- Use the platform before adding a dependency (WebCrypto, OPFS, SQLite SQL). Each new
  runtime dependency MUST be justified in the feature's `research.md`.
- Sync uses per-field last-writer-wins (LWW) on hybrid logical clocks (HLC) plus a
  union of events. Adopting a general CRDT library needs a constitutional amendment.

Rationale: a single maintainer and a long-lived personal tool. Every line of code is
a future liability.

### VII. Verified Correctness

- Every change MUST be test-backed at the lowest level that can observe it:
  - core logic: Vitest, no mocks
  - SQL and stats: Vitest against fixture databases
  - sync: convergence tests
  - user flows: Playwright
- Stats MUST have fixture tests covering backdated events, page-less events, multiple
  events on one day, tombstones, and year boundaries.
- Sync MUST have convergence tests: N peers that receive the same ops in any order,
  with duplicates, MUST reach identical database state.
- A bug fix MUST start with a failing test that reproduces the bug.

Rationale: stats that are silently wrong are worse than no stats.

## Technical Constraints

- **Platforms:**
  - the app is a PWA (iPhone home screen, Chrome on the Mac)
  - a Chrome Manifest V3 extension
  - an iOS Shortcut
  - No capability may require a paid Apple Developer account.
- **Stack:**
  - TypeScript (strict) with pnpm workspaces
  - Svelte 5 + Vite, with `vite-plugin-pwa`
  - `@sqlite.org/sqlite-wasm` on OPFS, in a Web Worker
  - Cloudflare Worker + D1 for the relay
  - Vitest and Playwright for tests
- **Relay:** stores and forwards opaque ciphertext only. It MUST NOT contain any
  domain logic, and it MUST stay within Cloudflare's free tier for a single user.
- **Performance:** a local write MUST be visible in the UI within 100 ms. Any stats
  screen MUST render within 200 ms on 10 years of synthetic data on a mid-range phone.
  Measure before optimizing.
- **Schema changes** MUST ship as forward-only, numbered migrations, with a test that
  migrates a fixture database from the previous version.

## Development Workflow

- **Spec-kit per feature.** Each feature follows spec-kit: `/speckit-specify`, then
  `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, and
  `/speckit-implement`.
  - Feature folders are numbered `specs/NNN-slug/`.
  - Every plan MUST include a Constitution Check table in which each principle is
    marked PASS or given a justified exception.
- **Contracts.** Boundaries between packages or devices (commands, the database
  schema, the sync wire format, the export format, the capture payload) MUST be
  documented in `specs/NNN-*/contracts/` before implementation.
- **Commits.** Commits are small and bisectable, and each one explains *why*. A commit
  MUST NOT mix a bug fix with a feature.
- **CI gates.** Before merging, typecheck, lint (including the boundary check), unit
  tests, convergence tests, and e2e tests MUST pass.

## Governance

- **Precedence.** This constitution supersedes other practices and guidance in the
  repository. Where they conflict, Principles I, II, and IV take precedence over all
  others.
- **Amendments.** An amendment is a pull request that edits this file. It MUST state
  its rationale and its impact on existing specs, and it MUST bump the version:
  - MAJOR: a principle is removed or redefined.
  - MINOR: a principle or section is added, or its guidance is materially expanded.
  - PATCH: wording only.
- **Compliance.** Compliance is reviewed at plan time (the Constitution Check) and at
  review time. Any deviation MUST be recorded in the plan's Complexity Tracking table,
  with the simpler alternative that was rejected.
- **Runtime guidance.** `docs/architecture.md` is the runtime architecture reference.
  When the two disagree, this document wins, and the architecture doc MUST be updated.

**Version**: 1.1.0 | **Ratified**: 2026-09-27 | **Last Amended**: 2026-09-29
