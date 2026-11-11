# Design

## Context

The motivation is in proposal.md ("Why"). Paths here are as they will be after
`rename-to-lector`. What couples the sync code to lector today:

| Where | Coupling |
|---|---|
| `packages/sync/src/engine.ts` | `SyncDeps.db: LectorDb`. It calls `syncMeta`/`setSyncMeta`, `inboxOpIds`, `applyPulledPage`, `unpushedOps`, `completePush`, `getMeta`, `resetPushState`, `pendingCount`, and **`duplicates()`** (lector-only, in `join`). It calls lector-core's `parseRemoteOp`. |
| `packages/sync/src/{keys,envelope,code}.ts` | Hard-coded `readerlog-sync-v1`, `readerlog/v1/…`, `readerlog:sync:1:` |
| `packages/sync/src/capturePeer.ts` | Lector domain: `decide`, `stampOps`, tags, highlights, `readerlog-*` id labels |
| `packages/lector-core/src/merge.ts` | `WRITABLE_FIELDS`, `INSERT_FIELDS`, `tierOf` and `parseRemoteOp` are keyed by lector's `Table` union. `mergeOp` is already generic. |
| `packages/lector-core/src/{hlc,ops}.ts` | Generic (`hlcNext`/`hlcReceive`/`compareHlc`, `stampOps`) |
| `packages/lector-db/src/apply.ts` | `upsertRow` reads lector's `WRITABLE_FIELDS`. Otherwise generic. |
| `packages/lector-db/src/sync.ts` | `canInsert` hard-codes the parent-row checks for `reading_events`, `highlights` and `item_tags`. The rest is generic over the allow-list. |
| `packages/lector-db/src/migrations.ts` | The bookkeeping tables are interleaved inside lector migrations 1 and 3 |
| `packages/sync/test/convergence.test.ts`, `harness.ts` | Use lector tables, `tierOf` and `LectorDb` |

Constraints:
- Lector migrations are forward-only and already applied on real devices, so they can't be
  reordered.
- The frozen identifiers are listed in `openspec/config.yaml`.
- The constitution's principles IV (pure core) and VI (two call sites) apply.

## Goals / Non-Goals

**Goals:**
- Lector behaves identically: same tests, same wire bytes for the same inputs, same DB file.
- A second app can get sync by supplying four things: a `SyncSchema`, a `canInsert` hook,
  an app config (salt, AAD prefix, QR prefix), and its own domain migrations placed after
  the shared bookkeeping DDL.
- The shared engine is proven by its own test, independent of lector.

**Non-Goals:**
- A plugin system, runtime schema registration, or multiple spaces per DB. Each app keeps
  one DB and one space.
- Moving the OPFS / Web Lock code. See decision 6.

## Decisions

### 1. Four shared or lector-side packages, not one "sync-kit"

```
packages/sync-core     pure, imports nothing: hlc, Result, OpWire/RemoteOp, SyncSchema,
                       parseRemoteOpWith, mergeOp, stampOps, SyncStore interface
packages/db-kit        sqlite plumbing over a SyncSchema (+ @sqlite.org/sqlite-wasm), imports sync-core
packages/sync          engine, envelope, keys, code, relayClient, push, ids; imports sync-core only
packages/lector-sync   lectorSyncApp config, capturePeer, lector convergence suite;
                       imports sync, sync-core, lector-core (never lector-db)
```

Why the pure parts are split from the SQLite parts:
- `lector-core` must stay pure and may only import pure code. The extension must not pull
  in SQLite.
- A single shared package would force one of those two rules to break.

Why `SyncStore` lives in `sync-core`:
- `db-kit` implements it and `sync` consumes it, so neither has to import the other.
- That keeps the dependency graph acyclic and the engine free of SQLite.

Alternatives rejected:
- **Cinefilo imports `lector-core` / `lector-db`.** Cinefilo would then depend on lector's
  domain.
- **Copy the engine into cinefilo.** That leaves two engines to keep convergent.
- **One `sync-kit` package holding pure and SQLite code together.** It breaks the
  purity rule for `lector-core`, which imports it.

### 2. `SyncSchema`: the allow-list becomes data

```ts
interface SyncSchema<T extends string = string> {
  writable: Readonly<Record<T, ReadonlySet<string>>>;
  insertRequired: Readonly<Record<T, readonly string[]>>;
  tierOf(tbl: T, fields: Readonly<Record<string, FieldValue>>): string;
}
```

- `parseRemoteOpWith(schema)` returns a parser with exactly today's checks: lowercase
  uuid op and row, known table, allow-listed fields, a well-formed HLC under the
  year-2255 cap, and scalar values.
- `lector-core` defines `lectorSchema` from the existing constants. It keeps exporting
  `WRITABLE_FIELDS`, `INSERT_FIELDS`, `tierOf` and `parseRemoteOp` (the last now
  `= parseRemoteOpWith(lectorSchema)`), so lector call sites don't change.
- The tier function stays app-owned. Lector's `base`/`h`/`t`/`s` tiers are lector's
  history of old versions. A new app starts with a single tier and adds its own later.

### 3. `canInsert` is an app hook in db-kit

The parent-row checks are domain knowledge, so db-kit takes
`canInsert(db, op) => boolean` beside the schema. Its default only checks the
insert-required fields. `lectorCanInsert` in `lector-db` keeps today's
`items`/`tags` lookups. Parking, the inbox drain and all-or-nothing application stay in
db-kit unchanged.

### 4. App config replaces the constants

```ts
interface SyncApp { salt: string; aadPrefix: string; qrPrefix: string; parseOp: (w: OpWire, device: string) => Result<RemoteOp, ParseError>; }
```

- `deriveKeys(k, salt)`, `seal`/`open(…, aadPrefix)` and
  `formatSyncCode`/`parseSyncCode`/`qrPayload(…, qrPrefix)` take the value as a parameter.
- `createSyncEngine({ store, app, fetch, now, random, online })`.
- `lectorSyncApp` holds the current strings.
- With distinct salts, a lector code can never derive a cinefilo space, and with distinct
  AADs, a batch from one app can't authenticate under the other.
- **Golden vectors**, recorded *before* the refactor, pin:
  - `spaceId`, `authToken` and the AES-GCM ciphertext for a fixed secret, IV and plaintext;
  - the formatted code and QR string.

### 5. `join()` stops knowing about duplicates

- The engine's `join` returns `ok({})`.
- Lector's worker calls `db.duplicates().length` after a successful join and replies with
  the same `{ duplicates }` shape it sends today, so the protocol and UI don't change.
- An optional `afterJoin` hook was considered and rejected: it would add an abstraction
  with one caller.

### 6. The OPFS / Web Lock worker helpers stay in `apps/lector` for now

Cinefilo will need the same SAH-pool install, Web Lock turn-taking and WAL pragmas. But
the constitution (VI) asks for two *present* call sites. `add-cinefilo` extracts them
(into `packages/opfs-db` or similar) in the same change that adds the second caller. This
change adds a pointer to that in the design.

### 7. Bookkeeping DDL: shared for new apps, verified for lector

- db-kit exports `SYNC_BOOKKEEPING_DDL`, a new app's migration 1 prefix, and `runMigrations(db, list)`.
- Lector keeps its migration strings unchanged and also uses `runMigrations`.
- A db-kit test checks that a migrated lector DB and a db-kit-bootstrapped toy DB have
  identical `field_clock`, `change_log`, `meta` and `sync_inbox` definitions (columns and
  indexes, read from `pragma_table_info` / `pragma_index_list`). That way the shared code
  can't silently diverge from lector's real tables.

### 8. Relay: no code change; a second adapter later

- `apps/relay` stays domain-free and is reused as is.
- `add-cinefilo` adds `apps/cinefilo/functions/api/[[path]].ts`, the same five lines as
  today's `functions/api/[[path]].ts`, with its own `RELAY_DB` binding to cinefilo's D1.
  The Pages project's root directory will be `apps/cinefilo`.
- This change only widens the dependency-cruiser rule so that `apps/*/functions/**` may
  import `apps/relay/src/**`, and nothing else under `apps/` may.

### 9. Dependency-cruiser rules

| Rule | From | Forbidden |
|---|---|---|
| `sync-core-is-pure` | `^packages/sync-core/src` | anything outside itself |
| `lector-core-is-pure` (renamed `core-is-pure`) | `^packages/lector-core/src` | anything except itself and `packages/sync-core/src` |
| `shared-no-apps-domain` | `^packages/(sync-core\|db-kit\|sync)/` | `^packages/(lector\|cinefilo)-`, `^apps/` |
| `lector-sync-no-db` | `^packages/lector-sync/` | `^packages/(lector-db\|db-kit)` (keeps the extension SQLite-free) |
| `relay-adapters` | `^apps/[^/]+/functions/` | `^apps/` except `^apps/relay/src` |

The existing `relay-is-opaque`, `extension-no-pwa-no-db` and `no-circular` rules stay.

### 10. Tests move with the code they prove

- The lector convergence suite and the `capturePeer` tests move to `packages/lector-sync/test`,
  with only their import paths changed. `test:convergence` points at the `lector-sync` project.
- `packages/sync/test` keeps the engine, envelope, keys, code, push and privacy tests,
  using a toy app config.
- It also gains `generic.convergence.test.ts`: two tables (`notes`, and `marks` with a
  parent FK), 3 peers, random order and duplicates, an op arriving before its parent row,
  and an LWW tie broken by device id. It runs on db-kit with an in-memory SQLite.

## Constitution check (lector)

| Principle | Status |
|---|---|
| I. Local-first | PASS: no change to when or how writes happen |
| II. User owns data | PASS: the same encryption and keys (pinned by golden vectors); the export is untouched |
| III. Events over state | PASS: not touched |
| IV. Functional core | PASS: `lector-core` imports only the pure `sync-core`; remote ops still go through the allow-list, all-or-nothing; dependency-cruiser enforces it |
| V. Friction | PASS: no UI change |
| VI. Simplicity | PASS: the abstractions have two call sites (lector now, cinefilo in `add-cinefilo`); worker helpers wait for theirs (decision 6); no CRDT library |
| VII. Verified | PASS: the existing suites move unchanged, plus golden vectors, the DDL-equivalence test and the generic convergence test |

## Risks / Trade-offs

- **[A string slips during the move and lector devices stop reading each other]** →
  golden vectors are written first (task 1). The full 1,000-run convergence test and e2e
  sync scenarios run at the end.
- **[`lector-core` re-exports hide where things live]** → the re-exports are explicit,
  in one `index.ts` block with a comment. The alternative, rewriting every import, means a
  bigger diff for no behaviour change.
- **[The DDL-equivalence test is too strict, e.g. on index names]** → compare
  columns, types, PK and partial-index predicates only, and document what is ignored.
- **[Moving the test suites loses history]** → use `git mv` so `git log --follow` keeps it.

## Migration Plan

- No data or schema migration. Users notice no difference after deploying.
- Land the change as bisectable commits in the task order. Each commit keeps
  `pnpm typecheck && pnpm lint && pnpm test` green.
- Rollback is a revert: nothing persisted changes.
