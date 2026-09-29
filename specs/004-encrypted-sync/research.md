# Research: Encrypted Sync (004)

## R1. Where the relay runs

- **Decision**: **Cloudflare Pages Functions** in the same Pages project as the PWA,
  under `functions/api/…` at the repo root. It uses a D1 database bound as `RELAY_DB`.
  The PWA calls same-origin `/api/v1/…`.
- **Rationale**:
  - Pages Functions *are* Workers (same runtime, same free allowance), so this meets the
    constitution's "Cloudflare Worker + D1" constraint.
  - It deploys automatically with every push to `main`, alongside the PWA: no second
    project, no `wrangler deploy`, and no API token in CI.
  - Same origin means no CORS, and no relay URL to configure per build.
  - Free allowance: 100k requests/day, D1 5M row reads/day, 100k row writes/day, 5 GB.
    One user syncing a few hundred times a day uses well under 1% (SC-007).
- **One-time manual setup** (quickstart):
  1. Create a D1 database `readerlog-relay`.
  2. Run `apps/relay/schema.sql` in its console.
  3. In the Pages project, go to Settings → Bindings → D1, and add `RELAY_DB`.
- **Alternatives considered**:
  - A standalone Worker (`workers.dev`): needs its own deploy pipeline and CORS.
    Rejected for now; the handler is host-agnostic (R9), so moving later is cheap.
  - A Durable Object: not needed at this volume.

## R2. Keys: sync code → space id, auth token, encryption key

- **Decision**:
  - The sync code is a 32-byte secret `K` from `crypto.getRandomValues`, in the shell.
  - It goes through HKDF-SHA-256 (WebCrypto) with salt `"readerlog-sync-v1"`. Three
    `info` labels derive three values:

    | `info` | Output | Used as |
    |---|---|---|
    | `"space-id"` | 16 bytes, lowercase hex | `spaceId` |
    | `"auth"` | 32 bytes, base64url | `authToken` |
    | `"enc"` | a non-extractable AES-GCM-256 key | `encKey` |

  - `K` itself never leaves the device (FR-003). The relay stores
    `SHA-256(authToken)` only.
- **Rationale**:
  - One secret to pair with.
  - The relay can check access without being able to decrypt.
  - `spaceId` reveals nothing about `K` (HKDF is one-way).
  - Everything is on the WebCrypto platform, so no dependency is needed
    (constitution VI).
- **Storage**:
  - `K` is stored in `meta.sync_key`, local only, since `meta` is never in `change_log`
    (FR-004).
  - It sits on OPFS, which is origin-private.
  - Wrapping it with a passphrase is out of scope: the user would have to type it on
    every launch.

## R3. The sync code the user sees

- **Decision**:
  - **Text code**: the 32 bytes plus a 2-byte checksum (the first 2 bytes of
    `SHA-256(K)`), in Crockford base32. That's 56 characters, shown in groups of 4
    separated by `-`.
  - Parsing:
    - is case-insensitive;
    - accepts `O`→`0` and `I`/`L`→`1`;
    - ignores spaces and hyphens;
    - rejects a wrong length or checksum before anything changes (FR-007).
  - **QR code**: `readerlog:sync:1:<56 chars>`, generated with **`qrcode-generator`**
    (MIT, no dependencies, about 20 KB minified). It is loaded lazily on the Show-code
    screen only.
  - **Scanning**: reuse the 002 scanner worker, with formats `['QRCode']`. zxing-wasm's
    reader build already decodes QR codes, so no new WASM is needed.
- **Rationale**:
  - The checksum catches typos locally.
  - Base32 is unambiguous to read aloud or retype.
  - Producing a QR code requires Reed-Solomon encoding and mask selection, several
    hundred lines to hand-write. That's the justified new runtime dependency (R13).
- **Alternatives**:
  - BIP-39 words: 24 words would need a 2,048-word list shipped with the app. Rejected.

## R4. Wire format: encrypted batches

- **Decision**:
  - A device pushes **batches** of up to 500 of its unpushed `change_log` rows.
  - Plaintext is
    `{ v: 1, device: <deviceId>, ops: [{ op, hlc, tbl, row, fields }] }`, as UTF-8 JSON,
    compressed with `CompressionStream('gzip')`. It's supported on iOS 16.4+ and
    Chrome; if missing, the batch goes uncompressed with a flag in the header.
  - Sealing: AES-GCM with a random 12-byte IV, and AAD =
    `"readerlog/v1/" + spaceId + "/" + batchId`.
  - Envelope sent to the relay: `{ batchId, iv, ct }`, base64url.
  - `batchId` is a random UUID, chosen and **persisted before sending**. A retry resends
    the same id, and the relay treats a duplicate as success (idempotent).
- **Rationale**:
  - The relay sees only size and arrival time (FR-001, SC-005). Table names, row ids
    and op ids are all inside the ciphertext.
  - The AAD binds each ciphertext to its space and batch, so the relay can't replay a
    batch into another space or swap batch ids undetected.
- **Security note**: a relay can withhold or delete batches (availability), but it can't
  forge or alter them. Every device keeps a full local copy (spec edge case).

## R5. Merge: applying remote ops (the pure core of sync)

- **Decision**: `mergeOp(clocks, op) → { winning: fields }` is pure, in
  `packages/core/src/merge.ts`. For each field in an op, the field wins if
  `field_clock` has no entry or `op.hlc > clock`. Ties can't happen, because an HLC
  includes the device id.
  - Applying a remote op, in one transaction per pulled page:
    1. Skip it if `op_id` is already in `change_log` (duplicate, or our own).
    2. Compute the winning fields, upsert only those, and set their `field_clock`.
    3. Insert the op into `change_log` with its **original** `op_id`, `hlc` and
       `device_id`, and `pushed = 1`. It's recorded but never re-pushed.
    4. Advance `meta.hlc` with `hlcReceive(local, remote.hlc, wallMs)`, the standard
       HLC receive rule, so the next local edit orders after everything seen. This is
       the spec's clock-skew edge case.
  - **Events** are rows too. Their fields are only set at insert, plus `deleted_at`, so
    field LWW gives "union by id, and the later tombstone wins" with no special case.
- **Order independence (SC-003)**: an op for a row that doesn't exist yet, and that
  lacks the fields needed to insert it (for example an item edit arriving before the
  item's insert), is **parked** in a local `sync_inbox` table.
  - After every applied page, the inbox is retried until a pass makes no progress.
  - Relay order already respects causality: a device only edits a row after pulling
    it, so its edit has a later `server_seq`. The inbox exists for the randomized
    convergence tests and for defence.
- **Rationale**: this is the constitution's merge model (LWW per field, plus a union of
  events). It's pure and property-testable.

## R6. Push and pull loop

- **Decision** (`packages/sync/src/engine.ts`, running **inside the DB worker**, which
  owns the database and holds the Web Lock):
  1. **Pull**: `GET /api/v1/spaces/:id/batches?after=<cursor>&limit=50`, repeated
     until `more: false`. Decrypt each batch, and apply each page of batches in one
     transaction (R5). `meta.sync_cursor` advances in the same transaction.
  2. **Push**: while unpushed rows exist, take up to 500 in `seq` order, persist the
     `pending_batch` (`batchId`, `maxSeq`), POST it, then set `pushed = 1` for
     `seq ≤ maxSeq` and clear the pending batch. On restart, a pending batch is resent
     with the same id.
  3. One run at a time (a mutex in the worker). A trigger during a run sets a "run
     again" flag.
- **Triggers** (from the main thread to the worker, FR-014):
  - app start;
  - `visibilitychange` → visible;
  - `online`;
  - 3 s after the last successful `dispatch` (debounced);
  - **the sync button** in the top bar (and **Sync now** in Settings → Sync).
  - There is **no background polling** in the MVP (the spec's Clarifications). An open
    device that sits idle receives changes when it's brought to the front or when the
    user taps the sync button. Polling every 5 s while visible fits the free tier
    (about 36 requests a minute for 3 devices) and can be added later.
  - After a run that received changes, the worker broadcasts on the existing channel,
    so the UI refreshes (FR-015).
- **Failures**:
  - Offline or network errors are normal: status "Offline — changes will be sent later"
    (spec assumption).
  - Other errors back off: 30 s, 2 min, then 10 min.
  - `401`/`404` from the relay mean the space is gone or the code is wrong. Sync stops,
    and the status says to rejoin (FR-021).

## R7. Join, leave, reset (US1, US4)

- **Turn on** (first device):
  1. Generate `K`.
  2. `PUT /api/v1/spaces/:id` with the bearer `authToken` creates the space. The relay
     stores the token hash; a `409` means it exists (practically impossible).
  3. Store `K`.
  4. Set `pushed = 0` on every `change_log` row and `sync_cursor = 0`.
  5. Sync.
- **Join**:
  1. Parse the code (R3).
  2. `GET /api/v1/spaces/:id` with the token gives `200` (exists) or `404`, which is
     reported, with no local change (US1 · 5).
  3. Store `K`, reset `pushed` and the cursor as above, then sync. Pulling first and
     then pushing combines both logs (FR-011).
  4. Run duplicate detection (R8).
- **Leave**: delete `sync_key`, `sync_cursor`, `pending_batch` and the sync status from
  `meta`. Local data is untouched (FR-019).
- **Reset**:
  1. Create a new space as in "Turn on".
  2. Push **every** `change_log` row, local and received, since replaying all of them
     reproduces the current state exactly under LWW.
  3. Only then `DELETE /api/v1/spaces/<old>` (FR-020).
  4. If the delete fails, retry it on later syncs (`meta.sync_old_space`).
- **Data from a deleted space** can only return through a device the user rejoins
  explicitly (FR-022).

## R8. Duplicate books (US5)

- **Detection**: pure `findDuplicates(books, dismissed)`, in core. It pairs live books
  when:
  - they have the same ISBN; or
  - at least one ISBN is missing, and their normalized `title + "|" + author` are equal.

  Normalization: NFD, strip combining marks, lowercase, replace punctuation with a
  space, and collapse whitespace.
- **Survivor**: the smaller `(created_at, id)`, the same on every device (FR-028).
- **`MergeBooks` command**: `{ survivorId, duplicateId, copies: [{ from: eventId, to: eventId }], localDate }`.
  - For each live event of the duplicate, it tombstones it and inserts a copy on the
    survivor with the same `event_type`, `page`, `occurred_at` and `local_date`.
    Events are never edited in place (constitution III).
  - It fills the survivor's empty `author`, `total_pages`, `genre`, `isbn` and
    `cover_url` from the duplicate, following the FillDetails rule.
  - It tombstones the duplicate.
- **Deterministic copy ids (FR-029)**: the shell derives
  `to = uuidFromHash(SHA-256("readerlog-merge-v1|" + survivorId + "|" + from))`, a
  v4-shaped UUID. Two devices merging the same pair emit the **same** inserts, which
  field LWW and the event union collapse to one.
  - `decide` checks that each `to` is a valid UUID. It doesn't recompute the hash,
    because core has no crypto.
- **Stragglers**: device B may log an entry on the duplicate after A merged it but
  before B synced. Without a fix, that entry would end up on a removed book.
  - `MergeBooks` therefore also sets `items.merged_into = survivorId` on the duplicate
    (a new synced column, migration 3).
  - After every sync that received changes, the shell looks for live events on items
    whose `merged_into` is set, and dispatches `MergeBooks` again for just those events,
    using the same deterministic copy ids.
  - So the result converges whichever device sweeps first.
- **Keep both**: a new synced table `duplicate_dismissals(id, item_a, item_b,
  created_at, deleted_at)`.
  - `id` is `uuidFromHash("readerlog-dismiss-v1|" + min(a,b) + "|" + max(a,b))`, so
    dismissing on two devices converges.
  - The `DismissDuplicate` command inserts it.
- **Rationale**: this is your refinement, which uses the timestamp each book was added
  to pick the survivor, extended with deterministic ids so concurrent merges converge.

## R9. The relay handler and its tests

- **Decision**: `apps/relay/src/handler.ts` exports
  `handle(request: Request, store: RelayStore, now: () => number): Promise<Response>`.
  - It's pure web-standard `Request`/`Response`.
  - `RelayStore` is a 7-method interface.
  - `functions/api/[[path]].ts` adapts the D1 binding to `RelayStore` (about 40 lines).
  - Tests use a `RelayStore` over in-memory SQLite-WASM with the **same**
    `schema.sql`, so there's no Miniflare or Wrangler dependency.
- **Endpoints** (`/api/v1`):
  - `PUT /spaces/:id`: create.
  - `GET /spaces/:id`: exists?
  - `DELETE /spaces/:id`: delete the space and its batches.
  - `POST /spaces/:id/batches`: body `{ batchId, iv, ct }`, returns
    `{ seq, duplicate }`.
  - `GET /spaces/:id/batches?after=&limit=`: returns
    `{ batches: [{ seq, batchId, iv, ct }], more }`.
- **Auth**: `Authorization: Bearer <authToken>` on every request. The relay compares
  `SHA-256(token)` in constant time.
- **Limits**:
  - a body of 1 MiB at most;
  - 120 requests/minute per space (a D1 counter row per minute bucket, FR-024), then
    `429` with `Retry-After`;
  - `limit` of 100 at most.
- **Logging**: the relay logs no request bodies and no space ids (FR-005).

## R10. E2e without a network

- **Decision**: `e2e/fixtures/relay.ts` routes `**/api/v1/**` through `page.route` to
  the **real** `handle()` with an in-memory store, shared by two browser contexts in one
  test. That makes it two devices. Everything else stays blocked, as in 002's
  unrouted-host guard.
- **Rationale**: it exercises the real client, crypto, worker and handler end to end,
  deterministically.

## R11. Convergence tests (constitution VII, SC-003)

- **Decision**: `packages/sync/test/convergence.test.ts` uses 2 to 5 `ReaderlogDb`
  instances, one per peer, each on in-memory SQLite, plus a fake relay (the real
  handler with an in-memory store).
  - Each run:
    1. random commands on random peers;
    2. random pushes and pulls, including duplicated deliveries and shuffled batch order
       fed directly to `applyRemoteOps`;
    3. finally everyone syncs until quiet.
  - The check: after the run, `items`, `reading_events`, `duplicate_dismissals` and
    `field_clock` dumps are identical across peers.
  - 1,000 seeded runs, using a seeded PRNG in the test and never `Math.random` in code
    under test.
- **Plus**: property tests for `mergeOp` and `hlcReceive` in core (commutativity,
  idempotence, and monotonicity).

## R12. Covers for synced books (FR-016)

- **Decision**: after a sync that received changes, the main thread runs the existing
  002 cover pipeline for live books with a `cover_url` and no `covers` row, when
  online. That's the same code as `detailsRetry`, and it adds no worker changes.

## R13. New dependencies, packages and migration

- **Runtime dependency**: `qrcode-generator` (R3), only. Crypto, compression, base32 and
  the HTTP client use the platform.
- **New package**: `packages/sync`, planned in `docs/architecture.md` §5, with
  crypto/envelope, the relay client, and the engine. It depends on `core` and `db`.
- **New app folder**: `apps/relay`, holding the handler, schema and store adapter. The
  Pages Functions entry is `functions/`.
- **Migration 3** (forward-only, tested from a v2 fixture):
  - `duplicate_dismissals`, with the synced columns above;
  - `items.merged_into TEXT`, which is synced;
  - `sync_inbox (op_id PRIMARY KEY, hlc, device_id, tbl, row_id, fields_json)`, local
    only;
  - `apply.ts`'s `WRITABLE` gains `duplicate_dismissals`.
  - The `meta` keys (`sync_key`, `sync_cursor`, `pending_batch`, `sync_status`,
    `sync_old_space`) need no DDL.
