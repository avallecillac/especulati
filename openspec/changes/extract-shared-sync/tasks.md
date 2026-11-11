# Tasks

Precondition: `rename-to-lector` is applied, so the paths and the `@especulati/*` scope
below exist. Every group ends green on `pnpm typecheck && pnpm lint && pnpm test`, and
each group is one bisectable commit.

## 1. Pin today's behaviour (tests only, no moves yet)

- [x] 1.1 Add golden-vector tests in `packages/sync/test/golden.test.ts`. For a fixed
  32-byte secret they pin `deriveKeys` → `spaceId`, `authToken`; `seal` with a fixed IV and
  batch id → the exact `ct`; `formatSyncCode` / `qrPayload` → the exact strings. Values are
  recorded from the current code. Verify that `pnpm test --project sync golden` passes on
  the unmodified code.
- [x] 1.2 Add a schema snapshot test in `packages/lector-db/test/bookkeeping.snapshot.test.ts`.
  It records `pragma_table_info` and `pragma_index_list` for `field_clock`, `change_log`,
  `meta` and `sync_inbox` after `migrate()`. Verify that it passes.

## 2. `packages/sync-core` (pure)

- [x] 2.1 Scaffold the `@especulati/sync-core` package (package.json, tsconfig without the
  DOM lib), a `sync-core` vitest project, and the `sync-core-is-pure` dependency-cruiser
  rule. Verify with `pnpm lint` and `pnpm typecheck`.
- [x] 2.2 `git mv` `hlc.ts`, `result.ts` and the generic id/parse helpers (`DeviceId`,
  `parseDeviceId`, `UUID_PATTERN`, `ParseError`) with their tests from `lector-core` to
  `sync-core`. In `lector-core/src/index.ts`, add an explicit re-export block. Allow
  `lector-core` → `sync-core` in the purity rule. Verify that the moved tests and every
  `lector-core` test pass.
- [x] 2.3 Test first: write `parseRemoteOpWith` tests on a toy schema (unknown table,
  non-writable field, bad uuid, HLC over the cap, non-scalar value, device taken from the
  HLC). Then add `SyncSchema`, `parseRemoteOpWith`, `mergeOp`, `stampOps`, the
  `OpWire`/`RemoteOp` types and the `SyncStore` interface to `sync-core`. Verify that the
  new tests pass.
- [x] 2.4 Define `lectorSchema` in `lector-core/src/merge.ts` from the existing constants.
  Re-implement `parseRemoteOp = parseRemoteOpWith(lectorSchema)` and keep the
  `WRITABLE_FIELDS` / `INSERT_FIELDS` / `tierOf` exports. Verify that
  `merge.test.ts`, `merge.property.test.ts` and `ops.test.ts` pass unchanged.

## 3. `packages/db-kit`

- [x] 3.1 Scaffold the `@especulati/db-kit` package (with the `@sqlite.org/sqlite-wasm` pin),
  a `db-kit` vitest project, and the `shared-no-apps-domain` rule covering `sync-core`,
  `db-kit` and `sync`. Verify with `pnpm lint`.
- [x] 3.2 Test first, against a toy two-table schema in in-memory SQLite: write
  `upsertRow`/`applyChanges` (atomic, `field_clock` + `change_log` + `meta.hlc`) and
  `applyRemoteOps` (LWW per field, parking via `canInsert`, inbox drain, all-or-nothing on a
  bad op, `pushed = 1`). Then move the implementations from `lector-db/src/{apply,sync}.ts`
  into db-kit, parameterised by `(schema, canInsert)`. Verify that the db-kit tests pass.
- [x] 3.3 Move `unpushedOps` (single-tier batches via `schema.tierOf`), `completePush`,
  `markPushed`, `pendingCount`, `inboxOpIds`, `resetPushState` and `syncMeta`/`setSyncMeta`
  into db-kit with their tests. Add `SqliteSyncStore implements SyncStore`. Verify that
  the db-kit tests pass.
- [x] 3.4 Add `SYNC_BOOKKEEPING_DDL` and `runMigrations(db, list)`. Add a test that a toy DB
  bootstrapped with that DDL has the same bookkeeping columns, PKs and partial-index
  predicates as the 1.2 lector snapshot. Verify that it passes.
- [x] 3.5 Make `lector-db` delegate:
  - `lectorCanInsert` keeps the `items`/`tags` parent checks;
  - `LectorDb` builds a `SqliteSyncStore(raw, lectorSchema, lectorCanInsert)` and exposes it
    as `db.syncStore`;
  - `migrate()` uses `runMigrations` with the unchanged migration strings.

  Verify that every `lector-db` test passes unchanged, including `migration2`–`migration5`,
  `apply`, `ops.equiv` and the 1.2 snapshot.

## 4. App-agnostic `packages/sync`

- [x] 4.1 Take `salt` in `deriveKeys`, `aadPrefix` in `seal`/`open` and `qrPrefix` in the code
  helpers. Define `SyncApp` and add `packages/lector-sync` (scaffold, a vitest project,
  and the `lector-sync-no-db` rule) exporting `lectorSyncApp` with the current strings.
  Point the golden tests at `lectorSyncApp`. Verify that the golden vectors from 1.1 still
  pass byte for byte.
- [x] 4.2 Change `createSyncEngine` to `{ store: SyncStore, app: SyncApp, fetch, now, random, online }`.
  Drop the `@especulati/lector-db` and `lector-core` imports, and make `join` return
  `ok({})`. Update `engine.test.ts`, `push.test.ts` and `privacy.test.ts` to use a toy app
  over db-kit. Verify that the sync tests pass and that `packages/sync/package.json` has no
  `lector-*` dependency.
- [x] 4.3 Update `apps/lector/src/worker/db.worker.ts`: build the engine with
  `store: db.syncStore, app: lectorSyncApp`, and after a successful join reply
  `{ duplicates: db.duplicates().length }`. Verify that the pwa tests pass and that
  `e2e/` sync and join scenarios (`pnpm e2e`) pass.
- [x] 4.4 Add `packages/sync/test/generic.convergence.test.ts` on db-kit with a toy
  `notes` + `marks` (FK) schema: 3 peers, shuffled delivery with duplicates, a child op
  before its parent, an LWW tie. All peers must reach identical table dumps. Verify that
  it passes with `CONVERGENCE_RUNS=200`.

## 5. Move the lector-only sync code

- [x] 5.1 `git mv` `capturePeer.ts` and its test to `packages/lector-sync`. Point
  `apps/lector-extension` imports at `@especulati/lector-sync/capturePeer`, and drop the
  `./capturePeer` export from `packages/sync`. Verify that the extension `build` (release
  check) and `build:e2e` succeed and the capture e2e passes.
- [x] 5.2 `git mv` `convergence.test.ts` and `harness.ts` to `packages/lector-sync/test`, with
  import paths changed only. Point the `test:convergence` script at the `lector-sync`
  project. Verify with `pnpm test:convergence` (1,000 runs) green.

## 6. Rules, docs and integration

- [ ] 6.1 Add the `relay-adapters` dependency-cruiser rule (`apps/*/functions/**` may import
  only `apps/relay/src/**` from `apps/`). Extend the lint paths in `package.json` to the new
  packages. Verify that `pnpm lint` passes and that a scratch import of `lector-core` from
  `packages/sync` fails lint (then revert the scratch import).
- [ ] 6.2 Update `docs/architecture.md` §5 (package map) and §7 (sync: engine plus app
  config, schema and hooks), plus the layout section of `CLAUDE.md`. Verify that the doc
  links resolve and that the package list matches `ls packages`.
- [ ] 6.3 Run the full gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm test:convergence` and `pnpm e2e`. All must be green.

## Workflow follow-up

- Archive with `openspec archive extract-shared-sync` after review.
- `add-cinefilo` builds on `sync-core`, `db-kit` and `sync`, and extracts the OPFS / Web
  Lock helpers there (design decision 6).
