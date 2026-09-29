---

description: "Task list for 004-encrypted-sync"
---

# Tasks: Encrypted Sync

**Input**: Design documents from `/specs/004-encrypted-sync/`

**Prerequisites**: plan.md, spec.md (US1–US5), research.md (R1–R13), data-model.md, contracts/ (relay-api, sync-client, commands-004, worker-api-004), quickstart.md

**Tests**: REQUIRED (Constitution VII). Write each test task first and confirm it fails
before implementing it.

**Execution**: per CLAUDE.md "Model roles", each task, or each `[P]` batch, goes to the
`implementer` agent (Sonnet). The main session reviews and commits after each phase.
Crypto, merge and relay tasks get an extra adversarial review by the main session.

**Always-applicable rules for every task:**

- **`packages/core` is pure.** It must not use the DOM, `fetch`, `crypto`, `Date.now`,
  `new Date`, `Math.random` or `CompressionStream`, and must not import other packages.
- **`apps/relay` never imports `packages/*`.** It handles opaque `{ batchId, iv, ct }`
  only.
- **`packages/sync` never imports `apps/*`.** Inject `fetch`, `now`, `random` and
  `online` (`SyncDeps`) so tests are deterministic.
- **Secrets stay out of logs.** Never log, throw or store in an error message: the sync
  code, `K`, the auth token, plaintext ops, or space ids (FR-005). Tests use fixed fake
  secrets.
- **Local writes are unchanged.** They still go through `decide()` and then
  `applyChanges`. Only *remote* ops use `applyRemoteOps` (plan, Complexity Tracking).
- **No automated test may call the real relay or any external host.** E2e routes
  `/api/v1/**` through `e2e/fixtures/relay.ts`.
- **Svelte 5 `{@const}` is derived.** Copy values before clearing state.
- **Only one agent may run `pnpm e2e` or a build at a time.**

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Wire up the new packages:
  - create `packages/sync` (`package.json` `@readerlog/sync`, depending on
    `@readerlog/core` and `@readerlog/db`; `tsconfig.json` extending
    `tsconfig.base.json` with `"lib": ["ES2022", "DOM"]` for WebCrypto types; `src/index.ts`);
  - create `apps/relay` (`package.json` `@readerlog/relay`, with no dependencies;
    `tsconfig.json`; `src/`, `test/`);
  - add Vitest projects `sync` (root `packages/sync`) and `relay` (root `apps/relay`,
    `include: ['test/**/*.test.ts']`) to `vitest.config.ts`. The relay tests may use
    `@sqlite.org/sqlite-wasm` as a **devDependency** of `apps/relay` only;
  - add dependency-cruiser rules: `relay-is-opaque` (from `^apps/relay` to
    `^packages/`, forbidden) and `sync-no-apps` (from `^packages/sync` to `^apps/`,
    forbidden);
  - add `"qrcode-generator": "2.0.4"` to `apps/pwa/package.json` dependencies, and
    `"@readerlog/sync": "workspace:*"`;
  - make sure `pnpm typecheck` covers the two new packages.

  Run `pnpm install`. `pnpm typecheck && pnpm lint && pnpm test` stay green, with 0
  tests in the new projects.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: the merge core, migration 3, remote apply, the relay, crypto, the engine
run loop, and convergence.

### Tests first

- [ ] T002 [P] Write `packages/core/test/merge.test.ts` and
  `packages/core/test/merge.property.test.ts` (contracts/sync-client.md "Merge"):
  - **`hlcReceive(local, remote, wallMs, deviceId)`**:
    - the result is greater than both;
    - when `wallMs` is the largest, it gives `wallMs` with counter 0;
    - when the remote's ms is the largest, it gives the remote's ms with its counter
      plus 1;
    - equal ms gives the max counter plus 1;
    - a counter overflow at 9999 rolls to ms + 1;
    - a `null` local works;
    - the result carries **our** `deviceId`.
  - **`parseRemoteOp`**:
    - rejects an unknown `tbl`;
    - rejects a field outside the table's writable set (the same sets as
      `packages/db/src/apply.ts`; move that list into core as `WRITABLE_FIELDS` and
      import it from db);
    - rejects a malformed HLC, op id or row id.
  - **`mergeOp`**: a field wins if and only if its clock is null or `op.hlc > clock`.
  - **Properties** (seeded PRNG in the test): invariants 1–3 of the contract, with
    order independence over random permutations of 2 to 30 ops on 1 to 3 rows.
- [ ] T003 [P] Write `packages/db/test/migration3.test.ts`:
  - take a v2 fixture DB (built by running migrations 1–2 and inserting books, events
    and covers), then run `migrate()`;
  - `user_version` is 3;
  - the rows are unchanged;
  - `duplicate_dismissals`, `sync_inbox` and `items.merged_into` exist, matching
    data-model.md verbatim;
  - `SCHEMA_VERSION` is 3.
- [ ] T004 [P] Write `packages/db/test/sync.apply.test.ts` for `applyRemoteOps`,
  `unpushedOps`, `markPushed` and `resetPushState` (contracts/sync-client.md "Apply"):
  - **a remote item insert** creates the row, sets `field_clock` for every field, and
    adds a `change_log` row with the op's own `op_id`, `hlc` and `device_id`, and
    `pushed = 1`;
  - **a duplicate `op_id`** is skipped, and nothing changes;
  - **an older remote edit** loses to a newer local edit of the same field; a newer one
    wins; different fields merge;
  - **a remote tombstone** (`deleted_at`) newer than a local edit wins;
  - **an edit before its insert** is parked in `sync_inbox`, then applied when the
    insert arrives in a later call, and the inbox is emptied;
  - **`meta.hlc` after apply** is greater than every received HLC, and a following
    local `dispatch` stamps a greater HLC;
  - **an exception mid-batch** rolls back everything, including the inbox and the
    cursor;
  - **`unpushedOps(limit)`** returns local rows only (`pushed = 0`) in `seq` order, as
    `OpWire` with **no** `meta` or `covers` content (FR-004); `markPushed(maxSeq)` sets
    `pushed = 1` for `seq ≤ maxSeq`;
  - **`resetPushState`** sets every row, local and received, to `pushed = 0` and
    `sync_cursor = 0`.
- [X] T005 [P] Write `apps/relay/test/handler.test.ts`, plus
  `apps/relay/test/sqliteStore.ts`: a `RelayStore` over in-memory SQLite-WASM that runs
  `apps/relay/schema.sql`. Cover every row of the table in contracts/relay-api.md:
  - create, exists, delete;
  - `401` for a wrong or missing token, and `404` for an unknown space;
  - no cross-space access with another space's valid token;
  - POST and list with `after`/`limit`/`more`;
  - an idempotent re-POST returns the same `seq` with `duplicate: true`;
  - `413` over 1 MiB;
  - `429` after 120 requests in one minute (using an injected `now`), then allowed in
    the next minute;
  - `Cache-Control: no-store` on every response;
  - error bodies never echo input.
- [ ] T006 [P] Write `packages/sync/test/code.test.ts`,
  `packages/sync/test/keys.test.ts` and `packages/sync/test/envelope.test.ts`:
  - **The code format**:
    - `formatSyncCode(k)` is 56 characters of Crockford base32 in groups of 4 joined
      by `-`;
    - `parseSyncCode` accepts lowercase, spaces, missing hyphens, `O`/`o`→0 and
      `I`/`L`→1;
    - it rejects wrong lengths (`'format'`) and a flipped character (`'checksum'`);
    - `qrPayload` / `parseQrPayload` round-trip, and the parser rejects other
      prefixes.
  - **Key vectors**: for `k = 0x00…0x1f`, record `spaceId` (32 lowercase hex characters)
    and `authToken` once from the implementation, **then check them against an
    independent computation in the test using `node:crypto` `hkdfSync`**, and hard-code
    them.
  - **The envelope**:
    - a seal/open round trip;
    - a tampered `ct`, `iv` or `batchId`, or a different `spaceId`, gives `'decrypt'`;
    - `v: 2` gives `'version'`;
    - the raw path (flag 0) works;
    - the ciphertext of a plaintext containing `"Dune"` does not contain `Dune` or its
      base64.

### Implementation

- [ ] T007 Implement the merge core in `packages/core/src/hlc.ts` (`hlcReceive`) and a
  new `packages/core/src/merge.ts`:
  - `RemoteOp`, `parseRemoteOp`, `mergeOp`;
  - `WRITABLE_FIELDS`: moved from db and extended with `duplicate_dismissals: id-less
    { item_a, item_b, created_at, deleted_at }` and `items.merged_into`;
  - `Table` gains `'duplicate_dismissals'`.

  Update `packages/db/src/apply.ts` to import `WRITABLE_FIELDS`. T002 must pass, and
  all existing tests must stay green.
- [ ] T008 Implement migration 3 in `packages/db/src/migrations.ts`, verbatim from
  data-model.md, then `packages/db/src/sync.ts`:
  - `applyRemoteOps`, following the per-op steps in contracts/sync-client.md, with the
    park requirements quoted there:
    - `items` needs `type`, `title` and `created_at`;
    - `reading_events` needs `item_id`, `event_type`, `occurred_at` and `local_date`;
    - `duplicate_dismissals` needs `item_a`, `item_b` and `created_at`;
    - then an inbox retry loop;
  - `unpushedOps`, `markPushed`, `resetPushState`;
  - `syncMeta` and `setSyncMeta` for the meta keys `sync_key`, `sync_cursor`,
    `pending_batch`, `sync_status` and `sync_old_space`.

  Export them from `packages/db/src/index.ts`, with thin `ReaderlogDb` wrappers. T003
  and T004 must pass.
- [X] T009 Implement the relay:
  - `apps/relay/schema.sql`, verbatim from data-model.md;
  - `apps/relay/src/store.ts` (`RelayStore`);
  - `apps/relay/src/handler.ts`:
    - routing, bearer auth with `SHA-256` (WebCrypto) and a constant-time compare;
    - JSON validation (`batchId` a UUID, `iv` 16 base64url characters, `ct` non-empty
      base64url), body-size check, rate limit, prune;
  - `apps/relay/src/d1Store.ts` (`RelayStore` over a D1 binding; the `D1Database` type
    is declared locally, with no `@cloudflare/workers-types` dependency);
  - `functions/api/[[path]].ts`:
    `export const onRequest = (ctx) => handle(ctx.request, d1Store(ctx.env.RELAY_DB), Date.now)`.

  Also add `navigateFallbackDenylist: [/^\/api\//]` to the workbox options in
  `apps/pwa/vite.config.ts`. T005 must pass.
- [ ] T010 Implement `packages/sync/src/code.ts`, `keys.ts` and `envelope.ts` per
  contracts/sync-client.md and research R2–R4:
  - HKDF-SHA-256 with salt `"readerlog-sync-v1"` and info `"space-id"`, `"auth"` and
    `"enc"`;
  - the `encKey` is non-extractable;
  - gzip through `CompressionStream`, with a raw fallback;
  - no dependencies.

  T006 must pass.
- [ ] T011 Write `packages/sync/test/engine.test.ts` first, then implement
  `packages/sync/src/relayClient.ts` and the run loop in `packages/sync/src/engine.ts`.
  The fake relay is the real `handle()` from `apps/relay/src/handler.ts` with the test
  SQLite store, wrapped as `fetch`. Import it **only in tests**, through a relative path
  from `packages/sync/test`.

  The tests:
  - **`run()` with sync off** is a no-op.
  - **With sync on**:
    - it retries `pending_batch` first, then pulls pages of 50 until `more: false`,
      applying each page in one transaction and advancing `sync_cursor` in the same
      transaction;
    - it then pushes batches of 500 at most;
    - it persists `pending_batch` before the POST, and clears it and marks rows pushed
      after.
  - **Crash simulation**: make the fake `fetch` throw after the relay stored a batch,
    then `run()` again. The same `batchId` is re-sent, and the relay returns
    `duplicate: true`. No double apply.
  - **Concurrency**: one run at a time. A second `run()` during a run sets "run
    again", and it runs once more.
  - **Errors**:
    - an offline or network error gives `problem: 'offline'`, with nothing changed;
    - `401` or `404` give `'unauthorized'` or `'spaceGone'`, and sync stops until
      rejoin;
    - a batch that fails to decrypt is skipped, `undecryptable` goes up, and the cursor
      advances;
    - `'version'` stops the cursor and gives `'newerVersion'`;
    - a relay `5xx` or a timeout gives `'relay'` and a backoff, with nothing changed.
  - **Push only** (FR-025): `run(reason, { pushOnly: true })` pushes pending batches and
    makes **no** `GET …/batches` request. The fake relay counts requests.
  - **Stuck inbox** (U1): after a run, `status().inboxStuck` is the number of
    `sync_inbox` rows older than one full pull, meaning their row never arrived.
  - **`changed: true`** only when remote ops were applied.
  - **Backoff delays** (30 s, 2 min, 10 min) are returned in the run result, rather
    than timers.

  In this task, implement `turnOn` and `join` only as far as the tests need to set up
  a space (a space-creation helper). Their user-facing flows are T015 and T016.
- [ ] T012 Write and pass `packages/sync/test/convergence.test.ts` (research R11,
  SC-003):
  - 2 to 5 peers (`ReaderlogDb` on in-memory SQLite, each with its own `DeviceId` and
    fake clock), plus one fake relay;
  - 1,000 seeded runs, each with 20 to 60 random steps:
    - `AddBook`, `EditBook`, `LogEvent`, `RemoveEvent`, `RemoveBook` on a random peer;
    - `run()` on a random peer;
    - direct `applyRemoteOps` of a random shuffled and duplicated subset of another
      peer's ops (to exercise the inbox);
  - then every peer runs until quiet (two full rounds with no changes);
  - assert that the dumps of `items`, `reading_events`, `duplicate_dismissals` and
    `field_clock`, ordered by primary key, are identical across peers;
  - print the seed on failure;
  - also add a 10k-op perf case (SC-004): one peer with about 10,000 ops pushes to an
    empty space, and a second peer joins and pulls. Both finish in under 60 s in Node,
    and the time is logged;
  - log the relay's request count and D1 row reads and writes (counted in the test
    store) for a simulated day of 3 devices: 50 opens, 50 foregrounds, 100 local writes
    and 20 sync-button taps each. Assert it stays under 10% of the free allowance
    (100k requests, 5M row reads and 100k row writes a day), per research R1 (FR-023,
    SC-007).

**Checkpoint**: merge, relay, crypto and engine are all proven headless. The main
session does an adversarial review of T007–T012 before committing.

---

## Phase 3: User Story 1 - Turn on sync and join my second device (Priority: P1) 🎯 MVP

**Goal**: Settings → Sync can turn sync on (showing a QR code and a text code), join by
paste or scan, and show the code again.

**Independent Test**: turn on sync in context A (with books), join in context B, and B
shows A's books.

- [ ] T013 [P] [US1] Write `e2e/fixtures/relay.ts`:
  - a Playwright fixture that routes `**/api/v1/**` for any page to the real `handle()`
    with one in-memory store per test, shared across contexts;
  - a `twoDevices` fixture that creates two contexts with separate storage;
  - extend the existing unrouted-host guard so it also fails on any other `/api` call.
- [ ] T014 [P] [US1] Write `e2e/sync-pair.spec.ts`:
  - **Turn on**: A adds 2 books, then Settings → Sync → **Turn on sync**.
    - A QR image (`role="img"`, name "Sync code QR") and a text code matching
      `/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/` are shown, with the "save this code" advice.
  - **Join**: B → **Join** → paste the code. Within 10 s, B's Library shows A's 2 books.
    - Count the clicks and fills on B from Settings to joined, and assert 5 or fewer
      (SC-001).
  - **Typos**: a code with one changed character shows "That code has a typo" and
    changes nothing; a code for an unknown space shows "No sync space found for this
    code".
  - **Show code again**: on A, **Show code** displays the same code.
  - **Scan**: covered with the fake camera (from 002's harness), showing a canvas that
    renders the QR payload. B joins by **Scan code**.
- [ ] T015 [US1] Implement the engine's `turnOn`, `join` and `showCode` in
  `packages/sync/src/engine.ts` (research R7):
  - `join` validates the code locally, then calls `GET /spaces/:id`. A `404` gives
    `notFound`, with no local change.
  - Both call `resetPushState`, then `run('manual')`.
  - `join` returns `{ duplicates }` (0 until US5).

  Add engine tests for the error kinds.
- [ ] T016 [US1] Wire up the worker and UI:
  - `apps/pwa/src/worker/db.worker.ts` creates the engine with the real `fetch`,
    `crypto.getRandomValues` and `navigator.onLine`, and handles the `sync` messages in
    contracts/worker-api-004.md;
  - `apps/pwa/src/lib/protocol.ts` gets the types, and `dbClient.ts` a `sync(action)`
    helper;
  - `apps/pwa/src/lib/qr.ts` lazy-imports `qrcode-generator` and renders an SVG string
    (error-correction level M);
  - the scanner accepts `formats` (default `['EAN13']`), and `Scan.svelte` gets a
    `mode="qr"` that resolves a `readerlog:sync:1:` payload;
  - `apps/pwa/src/screens/Sync.svelte` (route `#/settings/sync`, linked from Settings)
    has these states:
    - **off**: **Turn on sync** and **Join**;
    - **joining**: a textarea with the label "Sync code", **Join**, and **Scan code**;
    - **on**: **Show code** and a status placeholder, which is filled by US3.

  T014 must pass.

**Checkpoint**: two devices pair and share existing data. (Automatic sync after later
edits is US2.)

---

## Phase 4: User Story 2 - Changes flow between devices automatically (Priority: P1)

**Goal**: sync triggers, UI refresh on receive, merged conflicts, and covers for synced
books.

**Independent Test**: with paired contexts, log on A and it appears on B. Also cover
the offline and conflict cases.

- [ ] T017 [P] [US2] Write `e2e/sync-flow.spec.ts`:
  - **log and receive**: log a page on A (A pushes on the `write` trigger). Then B shows
    it within 10 s, with no reload, after each of:
    - bringing B to the front (`visibilitychange`);
    - tapping B's top-bar **Sync** button (accessible name "Sync now");
  - **offline**: A goes offline (`context.setOffline(true)`), logs 3 entries with
    **Yesterday** on one, then goes online. B receives them with the original dates;
  - **concurrent edits**: both offline, a title edit on A and a page-count edit on B,
    both online. Both show both edits;
  - **remove**: removing a book on A removes it on B;
  - **relay down**: with the relay routed to `503`, add a book and log a page. No error
    dialog is shown, only the sync status (SC-006).
- [ ] T018 [US2] Implement the triggers, the sync button and refresh:
  - `apps/pwa/src/lib/sync.svelte.ts` sends `start` after DB-ready, `visible` on
    `visibilitychange`, `online`, and `write` 3 s after the last successful `dispatch`
    (hook into `dbClient.dispatch`, debounced). There is no background polling (spec
    Clarifications);
  - the **sync button** in the top bar of `apps/pwa/src/App.svelte` is shown only while
    sync is on:
    - its accessible name is "Sync now";
    - it sends `manual`;
    - it shows a spinning state while a run is in progress, and is disabled then;
    - it doesn't show errors (US3 owns the status);
  - after a run with `changed: true`, the worker broadcasts on `CHANNEL`, and the
    calling tab `notify()`s (FR-015);
  - after a changed run, the main thread queries `missingCovers` (new, in
    `packages/db/src/queries.ts` and the worker) and runs the existing 002 cover
    download plus `storeCover` for each, when online (FR-016, research R12).

  T017 must pass, and all existing e2e tests must stay green.

---

## Phase 5: User Story 3 - See whether sync is healthy (Priority: P2)

- [ ] T019 [P] [US3] Write `e2e/sync-status.spec.ts`:
  - 3 changes made offline show "3 changes waiting to sync";
  - after coming online and syncing, it shows "Last synced: just now" and "0 changes
    waiting";
  - **Sync now** triggers a run: route the relay to count requests and see it
    increase;
  - a relay `404` for the space shows "This sync space no longer exists. Rejoin with a
    new code." and the app still works.
- [ ] T020 [US3] Add the status view:
  - the engine's `status()` returns
    `{ on, lastOkAt, pending: count(pushed = 0), problem, undecryptable }`;
  - `Sync.svelte` shows it, with plain-language messages per `SyncProblem`:
    - `offline`: "Offline — changes will be sent later";
    - `relay`: "Can't reach the sync service — will retry";
    - `spaceGone` / `unauthorized`: "This sync space no longer exists. Rejoin with a
      new code.";
    - `newerVersion`: "Another device uses a newer Readerlog — update this one";
    - `corrupt`: "N changes couldn't be read and were skipped". This also counts
      `inboxStuck` changes, which are waiting on data that never arrived;
  - a relative time for `lastOkAt`;
  - the **Sync now** button;
  - a one-line status on the main Settings screen.

  T019 must pass.

---

## Phase 6: User Story 4 - Leave a space, or start over (Priority: P3)

- [ ] T021 [P] [US4] Extend `packages/sync/test/engine.test.ts`:
  - `leave()` removes `sync_key`, `sync_cursor`, `pending_batch` and `sync_status`,
    and keeps all rows;
  - `reset()` creates a new space, pushes **every** `change_log` row, then `DELETE`s
    the old space. If the DELETE fails, `sync_old_space` is kept and retried on the
    next `run()`;
  - a peer still on the old space gets `spaceGone`;
  - that peer rejoins with the new code: its local-only data merges in, and the other
    peers converge.
- [ ] T022 [P] [US4] Write `e2e/sync-reset.spec.ts`:
  - **leave**: **Leave sync space** → confirm, and the device keeps its books. Changes
    on the other device no longer arrive.
  - **reset**: A → **Reset sync** → confirm shows a new code. B's status then says
    rejoin. B joins with the new code, and both show the union of their books.
- [ ] T023 [US4] Implement `leave` and `reset` in the engine, and the confirm dialogs in
  `Sync.svelte`:
  - Leave: "This device will stop syncing. Its data stays here."
  - Reset: "Creates a new sync code and deletes the old space. Your other devices must
    join again with the new code."

  T021 and T022 must pass.

---

## Phase 7: User Story 5 - Merge books I added on both devices (Priority: P2)

- [ ] T024 [P] [US5] Write `packages/core/test/duplicates.test.ts` for
  `normalizeForMatch` and `findDuplicates` (research R8):
  - `"Cien años de soledad"` and `"CIEN AÑOS  DE SOLEDAD!"` match;
  - the same ISBN matches whatever the titles;
  - two **different** ISBNs never match, even with identical titles;
  - one missing ISBN plus the same title and author matches;
  - the survivor is the smaller `(createdAt, id)`;
  - removed books are ignored;
  - a dismissed pair (in either order) is excluded;
  - each pair is reported once.
- [ ] T025 [P] [US5] Write `packages/core/test/decide.mergeBooks.test.ts` and
  `decide.dismissDuplicate.test.ts`, covering every rejection row and the change order
  in contracts/commands-004.md:
  - the sweep mode;
  - fill-only-empty fields, including the `total_pages` below-max-page guard;
  - invariants M-1, M-2 and M-3, as a property test with random event sets;
  - `DismissDuplicate` is idempotent and normalizes `itemA`/`itemB` to min and max.
- [ ] T026 [US5] Implement the merge commands:
  - `packages/core/src/duplicates.ts`;
  - the `MergeBooks` and `DismissDuplicate` commands and the multi-book snapshot
    (`packages/core/src/commands.ts`, `decide.ts`);
  - `loadBooksSnapshot(db, ids)` in `packages/db/src/snapshot.ts`;
  - `ReaderlogDb.dispatch` loads the right snapshot per command kind;
  - `apps/pwa/src/lib/ids.ts`, with `uuidFromHash`, `mergeCopyId` and `dismissalId`
    per the contract, and a unit test in the `pwa` Vitest project with fixed vectors.

  T024 and T025 must pass.
- [ ] T027 [US5] Add convergence coverage: extend `packages/sync/test/convergence.test.ts`
  with `MergeBooks` and `DismissDuplicate` steps, and a **straggler** scenario:
  - peer A merges X into S while peer B logs an entry on X;
  - after sync, a sweep dispatch on any peer moves the entry onto S;
  - all peers end with each entry exactly once on S (FR-029);
  - **a chain**: X is merged into S, and then S into T. A straggler entry on X ends on
    T, because the sweep follows `merged_into` to the final live book.

  Uses deterministic ids computed in the test with `node:crypto` SHA-256, matching
  `ids.ts`.
- [ ] T028 [US5] Build the UI and the sweep:
  - `duplicates` query (worker plus `packages/db/src/queries.ts`), per
    worker-api-004.md;
  - `apps/pwa/src/screens/Duplicates.svelte` (route `#/settings/sync/duplicates`):
    - it lists each pair side by side: title, author, ISBN, entry count, and "Added
      <date>";
    - the survivor is marked "Kept";
    - **Merge** dispatches `MergeBooks`, with copies from `mergeCopyId`;
    - **Keep both** dispatches `DismissDuplicate`;
  - after `join` with `duplicates > 0`, show "N books may be duplicates — Review";
  - Settings → Sync has **Check for duplicates**;
  - the straggler sweep runs after each changed sync run: for items with a
    `merged_into` and live events, dispatch `MergeBooks` in sweep mode.

  Then write `e2e/duplicates.spec.ts`: US5 · 1, 2, 4 and 5, with two contexts, each
  adding "Dune" with the same ISBN before pairing.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T029 [P] Add a privacy audit test (SC-005, FR-004), `packages/sync/test/privacy.test.ts`:
  - after a convergence run, dump every relay row: no title, author, ISBN, date, page
    string, `op_id`, row id or device id appears in plaintext or in base64;
  - decrypt every pushed batch with the test key: no `covers` data, `meta` keys or the
    Google key.
- [ ] T029b Rate-limit space creation. `PUT /spaces/:id` is currently open and not
  rate-limited, because a new space has no token to check yet. Anyone who knows the URL
  could fill D1 with junk spaces.
  - Add a per-client limit of 10 PUTs a minute, keyed by
    `SHA-256("put|" + CF-Connecting-IP)`, in the `rate` table. The hash is kept at most
    10 minutes and is never logged.
  - Add a handler test for it.
- [ ] T030 Update the docs (main session):
  - `docs/architecture.md` §5 and §7, and `CLAUDE.md` Commands and Layout
    (`packages/sync`, `apps/relay`, `functions/`);
  - confirm the quickstart's Cloudflare setup steps against the implementation.
- [ ] T031 Run the full validation (main session):
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e`, plus `--repeat-each=2` on
    the sync specs;
  - quickstart scenarios 1–20;
  - an adversarial review of the relay and crypto code;
  - fill in the quickstart's validation results;
  - bump `apps/pwa` to `0.4.0`.

---

## Dependencies & Execution Order

- **Phase 1** comes first.
- **Phase 2**: the tests T002–T006 run in parallel. Then T007 → T008. T009 and T010
  run in parallel with T007 and T008 (different packages). T011 needs T008–T010, and
  T012 needs T011.
- **US1** needs Phase 2. **US2** needs US1 (pairing). **US3** and **US4** need US1, and
  can run in either order. **US5** needs Phase 2 for the core and db parts, and US1 for
  the UI.
- **Polish** runs last.

## Parallel batches (for implementer agents)

| Batch | Tasks | Notes |
|---|---|---|
| A | T001 | one agent |
| B | T002, T003, T004, T005, T006 | five test files in separate packages |
| C | T007 → T008 (core + db) ∥ T009 (relay) ∥ T010 (sync crypto) | three agents |
| D | T011 → T012 | one agent |
| E | T013, T014 → T015 → T016 | one agent, e2e |
| F | T017 → T018 | one agent, e2e |
| G | T024, T025 → T026 → T027 | core/db, runs alongside E and F |
| H | T019 → T020, T021, T022 → T023 | e2e |
| I | T028 | e2e |
| J | T029 | |

## Implementation Strategy

1. **MVP**: Phase 1 + Phase 2 + US1 + US2. Two devices pair and stay in sync
   automatically. This needs the manual Cloudflare D1 setup (quickstart) before it
   works in production.
2. **Next**: US5, since both devices already have books, so duplicates are likely on
   the first real join. **Merge to `main` only after US5**, or pair only from a
   device with an empty library.
3. **Then**: US3 (status) and US4 (leave/reset).
4. **Polish**: the privacy audit, docs, validation, and release 0.4.0.
