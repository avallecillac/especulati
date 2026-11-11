# Proposal

## Why

Cinefilo needs the same local-first sync lector already has: per-field LWW on HLC, encrypted
batches, a relay that only sees ciphertext, the inbox for ops that arrive early. That code
works and has a 1,000-run convergence test behind it. But today it is welded to lector's
domain:

- the sync engine takes a `LectorDb`;
- the allow-list (`WRITABLE_FIELDS`, `INSERT_FIELDS`, `tierOf`, `parseRemoteOp`) lives in
  `lector-core` and names lector's tables;
- the foreign-key wait in `applyRemoteOps` hard-codes `items`, `highlights` and `item_tags`;
- the HKDF salt, envelope AAD and QR prefix are `readerlog-*` constants.

So cinefilo can't reuse it without either importing lector's domain or copying the engine.
Copying would leave two sync engines to keep correct. This change pulls the generic parts
out, with **no behaviour change for lector**, so `add-cinefilo` can build on them.

## What Changes

- **New `packages/sync-core` (pure).** It holds:
  - the HLC (moved from `lector-core`);
  - the `OpWire` / `RemoteOp` types;
  - `Result`;
  - a `SyncSchema` type: per-table writable fields, insert-required fields, and a tier
    function;
  - `parseRemoteOpWith(schema)`, `mergeOp` and `stampOps`;
  - the `SyncStore` interface that the engine talks to.

  `lector-core` re-exports what it moved, so lector call sites don't change.
- **New `packages/db-kit`.** It holds the generic SQLite plumbing, all parameterised by a
  `SyncSchema` and an app-supplied `canInsert` hook:
  - `upsertRow`, `applyChanges` and `readMeta` / `writeMeta`;
  - `applyRemoteOps`, `applyPulledPage`, `unpushedOps`, `completePush` and the inbox;
  - `syncMeta` / `setSyncMeta`;
  - a migration runner;
  - the bookkeeping DDL (`field_clock`, `change_log`, `meta`, `sync_inbox`) for new apps.

  `lector-db` keeps its migrations byte-for-byte and delegates to db-kit, using
  `lectorSchema` and `lectorCanInsert`.
- **`packages/sync` becomes app-agnostic.**
  - `createSyncEngine` takes a `SyncStore` plus an `app` config
    (`{ salt, aadPrefix, qrPrefix, parseOp }`) instead of `LectorDb` and the hard-coded
    constants.
  - `join()` no longer counts lector duplicates. Lector's worker does that after a
    successful join, and the UI sees the same result.
- **New `packages/lector-sync`.** It holds `lectorSyncApp`, the frozen lector values
  (`readerlog-sync-v1`, `readerlog/v1/`, `readerlog:sync:1:`). It also takes over the
  push-only `capturePeer.ts` and the lector convergence suite, moved from `packages/sync`.
- **Dependency rules.** New dependency-cruiser rules: shared packages (`sync-core`,
  `db-kit`, `sync`) must not import any `lector-*` or `cinefilo-*` package, and `sync-core`
  imports nothing.
- **A generic convergence test.** It runs on a toy two-table schema in `packages/sync`, so
  the shared engine is proven without lector.

No requirement changes, so there is no spec delta (`skip_specs: true`).

## Capabilities

### New Capabilities

None. The behaviour is unchanged; this is a refactor.

### Modified Capabilities

None.

## Impact

- **Frozen identifiers.** No lector storage or wire identifier changes value. The HKDF salt
  `readerlog-sync-v1`, the envelope AAD `readerlog/v1/<space>/<batch>` and the QR prefix
  `readerlog:sync:1:` move from constants in `packages/sync` to `lectorSyncApp` in
  `packages/lector-sync`, with the same strings. Golden-vector tests pin them: the same
  secret gives the same `spaceId`, `authToken` and ciphertext before and after. OPFS names,
  derived-id labels, the export format and localStorage keys are not touched.
- **Packages:**
  - new: `packages/sync-core`, `packages/db-kit`, `packages/lector-sync`;
  - changed: `packages/lector-core`, `packages/lector-db`, `packages/sync`,
    `apps/lector` (the worker wiring), `apps/lector-extension` (it imports `capturePeer`
    from `@especulati/lector-sync`);
  - config: `vitest.config.ts` projects, the `test:convergence` script, and
    `.dependency-cruiser.cjs`.
- **Relay:** no change to `apps/relay` or `functions/`.
- **Docs:** `docs/architecture.md` §5 and §7 get the new package map.

### Out of scope

- Any cinefilo code: its schema, app, Pages adapter and D1. That is `add-cinefilo`.
- Extracting the OPFS / Web Lock worker helpers. That waits for its second call site in
  `add-cinefilo`.
- Any change to merge semantics, the wire format, batch tiers or the relay API.
- Renaming the frozen `readerlog-*` strings.
