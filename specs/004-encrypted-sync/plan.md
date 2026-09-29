# Implementation Plan: Encrypted Sync

**Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `004-encrypted-sync`) | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-encrypted-sync/spec.md`

## Summary

Every device keeps its full SQLite log. Sync exchanges `change_log` ops through a relay
that only stores ciphertext.

- **Keys** (research R2, R3): a 32-byte sync code yields a space id, an auth token and
  an AES-GCM key through HKDF. The code is shown as a checksummed base32 text code and
  a QR code.
- **Transport** (R4, R6): devices push encrypted, gzipped batches of up to 500 ops with
  idempotent batch ids. They pull by cursor, and apply each page in one transaction.
  The engine runs in the DB worker.
- **Merge** (R5): per-field last-writer-wins on HLC through pure `mergeOp` and
  `hlcReceive`. Events union by id. Ops that arrive before the row exists are parked in
  a local inbox, so any arrival order converges (SC-003).
- **Relay** (R1, R9): a host-agnostic `handle(Request) → Response`, served by Cloudflare
  Pages Functions on the same origin, with D1. It deploys with the site.
- **Duplicates** (R8, your refinement): after joining, likely duplicates (same ISBN, or
  same title and author) are offered.
  - **Merge** keeps the earliest-added copy and copies entries onto it with
    deterministic ids, so concurrent merges converge.
  - A sweep catches entries logged on a merged-away copy.
  - **Keep both** is a synced dismissal.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22. Unchanged.

**Primary Dependencies**:

- New runtime dependency: `qrcode-generator` 2.0.4 (MIT, no deps; research R3).
- WebCrypto (HKDF, AES-GCM, SHA-256), `CompressionStream`, and the existing
  `zxing-wasm` (QR decode).
- New workspace package: `packages/sync`.
- New app folder: `apps/relay`, plus the `functions/` Pages entry.

**Storage**:

- Device: SQLite schema **v3**, which adds `duplicate_dismissals`, `items.merged_into`
  and `sync_inbox`.
- Relay: D1 (`spaces`, `batches`, `rate`).

**Testing**:

- **core**: `mergeOp`, `hlcReceive`, `findDuplicates` and `MergeBooks`, with property
  tests.
- **db**: migration 3 from a v2 fixture, and `applyRemoteOps` (skip, park, inbox
  retry).
- **sync**: code and keys test vectors, the envelope, the engine against a fake relay,
  1,000 seeded convergence runs, and a 10k-op perf test.
- **relay**: the handler over a SQLite-WASM store.
- **e2e**: two browser contexts with an in-memory relay routed through `page.route`
  (R10).

**Target Platform**: iOS 17+ installed web app and Chrome on the Mac. Cloudflare Pages
with Functions and D1.

**Project Type**: the existing monorepo, plus the `packages/sync` package and the
`apps/relay` folder.

**Performance Goals**:

- A change is visible on another device within 10 s of it being opened, brought to the
  front, or its sync button being tapped (SC-002). There's no background polling in the
  MVP.
- A first sync of 10k ops takes under 60 s (SC-004).
- Sync never blocks the UI: it runs in the worker, one page per transaction.

**Constraints**:

- The relay sees ciphertext and sizes only (FR-001, SC-005).
- It stays within the free tier (SC-007).
- Offline is normal (SC-006).

**Scale/Scope**:

- 5 user stories.
- Settings → Sync screens: status, turn on, show code, join (paste or scan), leave,
  reset, and duplicates.
- About 10k ops per decade.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Local-first | Every read and write stays local. Sync runs in the background and is optional; offline is a normal state (FR-014, SC-006). No flow waits on the relay. | PASS |
| II. The user owns the data | E2E encryption with a key only the devices hold. The relay stores ciphertext plus sizes and times only, and holds no op ids, row ids or table names (R4, SC-005). No analytics. `meta` (keys, settings) and `covers` never sync (FR-004). **Note:** the relay learns batch sizes and timing, which is metadata inherent to any relay. It is accepted and documented. | PASS |
| III. Events over state | Remote ops apply as field LWW, so events are only inserted or tombstoned. `MergeBooks` tombstones and re-inserts events rather than moving them (R8). Status is still derived. | PASS |
| IV. Functional core, imperative shell | `mergeOp`, `hlcReceive`, `findDuplicates` and `MergeBooks` are pure, in core. Crypto, `fetch` and ids come from the shell. Remote ops use the **remote-change exception** (constitution v1.1.0): they skip `decide()`, pass `parseRemoteOp`'s allow-list, and are applied all-or-nothing, updating `field_clock` and `change_log`. Local writes, including merges and dismissals, still go through `decide()`. | PASS |
| V. Near-zero friction | No capture flow changes. Pairing is one-time: at most 5 taps on the new device (SC-001). Sync is automatic. | PASS |
| VI. Simplicity | Per-field LWW plus an event union, and no CRDT library. The only new dependency is a QR generator (R3). `packages/sync` was already planned. The relay is one handler of about 150 lines, with no Durable Objects. | PASS |
| VII. Verified correctness | Convergence tests with 2 to 5 peers, any order, duplicates, 1,000 runs (R11). Property tests for merge. A migration fixture test. Relay tests on the real schema. E2e with two devices. | PASS |
| Tech constraints | The relay is a Cloudflare Worker (Pages Functions) with D1, within the free tier, holding ciphertext only and no domain logic. Migration 3 is forward-only and fixture-tested. No Apple account needed. | PASS |

**Post-design re-check (after Phase 1):** PASS.

- Contracts: `relay-api.md`, `sync-client.md`, `commands-004.md` and
  `worker-api-004.md`, each with a named consumer and tests.
- The relay handler has no knowledge of ops: it stores opaque `{ batchId, iv, ct }`
  only.
- `docs/architecture.md` §7 will be updated:
  - the relay runs on Pages Functions;
  - batches, not individual ops, are the relay's unit;
  - there is an inbox for out-of-order ops;
  - duplicate merging is added.

## Project Structure

### Documentation (this feature)

```text
specs/004-encrypted-sync/
├── plan.md
├── research.md            # R1–R13
├── data-model.md          # migration 3, meta keys, core types, relay D1 schema
├── quickstart.md          # Cloudflare setup, scenarios 1–20, manual device checks
├── contracts/
│   ├── relay-api.md       # HTTP endpoints, auth, limits, RelayStore
│   ├── sync-client.md     # code/keys, envelope, merge, applyRemoteOps, engine
│   ├── commands-004.md    # MergeBooks (+ sweep), DismissDuplicate, id helpers
│   └── worker-api-004.md  # sync messages, duplicates/missingCovers queries, triggers
├── checklists/requirements.md
└── tasks.md               # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── hlc.ts              # + hlcReceive
├── merge.ts            # new: RemoteOp, parseRemoteOp, mergeOp
├── duplicates.ts       # new: normalizeForMatch, findDuplicates
├── commands.ts         # MergeBooks, DismissDuplicate; Table += duplicate_dismissals
└── decide.ts           # the two new commands (multi-book snapshot)

packages/db/src/
├── migrations.ts       # migration 3
├── apply.ts            # WRITABLE += duplicate_dismissals, items.merged_into
├── sync.ts             # new: applyRemoteOps, inbox, unpushedOps, markPushed, resetPushState, sync meta
└── queries.ts          # duplicates view, missingCovers, loadBooksSnapshot

packages/sync/          # new package (depends on core, db)
├── src/code.ts, keys.ts, envelope.ts, relayClient.ts, engine.ts
└── test/               # keys vectors, envelope, engine (fake relay), convergence, perf

apps/relay/
├── schema.sql
├── src/handler.ts, src/store.ts (RelayStore), src/d1Store.ts
└── test/handler.test.ts (+ sqliteStore.ts test adapter)
functions/api/[[path]].ts   # Pages Functions entry: env.RELAY_DB → d1Store → handle()

apps/pwa/src/
├── worker/db.worker.ts     # hosts the sync engine; sync messages
├── lib/sync.svelte.ts      # triggers, status store
├── lib/ids.ts              # uuidFromHash, mergeCopyId, dismissalId
├── lib/qr.ts               # lazy qrcode-generator → SVG
├── screens/Sync.svelte     # status, turn on, show code, join (paste/scan), leave, reset
├── screens/Duplicates.svelte
└── scanner/…               # accept a formats option (QRCode for pairing)

e2e/
├── fixtures/relay.ts       # page.route → real handle() with an in-memory store
└── sync-pair.spec.ts, sync-flow.spec.ts, sync-status.spec.ts, sync-reset.spec.ts, duplicates.spec.ts
```

**Structure Decision**:

- `packages/sync` is its own package because it has two consumers: the PWA worker now,
  and the Chrome extension in 005. It also keeps crypto out of `db`.
- The relay handler lives under `apps/relay`, and `functions/` is only the thin Pages
  adapter that Cloudflare requires at the project root.
- Dependency-cruiser rules gain:
  - `packages/sync` must not import `apps/*`;
  - `apps/relay` must not import `packages/*`. The relay knows nothing about the
    domain.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| New runtime dependency (`qrcode-generator`) | QR encoding: Reed-Solomon codes plus mask scoring. | Hand-writing it is about 500 lines of error-prone code. Text-only pairing would make the phone ↔ Mac pairing worse. |
| Migration 3 | A synced dismissals table, the `merged_into` straggler fix, and the local inbox. | Storing dismissals in `meta` wouldn't sync (FR-026 needs "on any device"). |
