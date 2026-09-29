# Contract: Sync client (`packages/sync`) and merge (`packages/core`, `packages/db`)

## Code and keys (`packages/sync/src/code.ts`, `keys.ts`)

```ts
function newSyncSecret(random: (n: number) => Uint8Array): Uint8Array;           // 32 bytes
function formatSyncCode(k: Uint8Array): string;      // Crockford base32 of k‖sha256(k)[0..3] (35 bytes = 280 bits = exactly 56 chars, no padding), "XXXX-XXXX-…"
function parseSyncCode(s: string): Result<Uint8Array, 'format' | 'checksum'>;     // tolerant: case, O→0, I/L→1, spaces, '-'
function qrPayload(k: Uint8Array): string;           // "readerlog:sync:1:<56 chars>"
function parseQrPayload(s: string): Result<Uint8Array, 'format' | 'checksum'>;
function deriveKeys(k: Uint8Array): Promise<{ spaceId: string; authToken: string; encKey: CryptoKey }>;   // research R2
```

Test vectors are fixed in `packages/sync/test/keys.test.ts`:

- `k = 00 01 … 1f` → its `spaceId`, `authToken` and code string, recorded once and
  asserted forever. They change only with a new version prefix.

## Envelope (`envelope.ts`)

```ts
interface OpWire { op: string; hlc: string; tbl: string; row: string; fields: Record<string, string | number | null> }
interface Plain  { v: 1; device: string; ops: OpWire[] }
function seal(p: Plain, key: CryptoKey, spaceId: string, batchId: string): Promise<{ batchId: string; iv: string; ct: string }>;
function open(e: { batchId: string; iv: string; ct: string }, key: CryptoKey, spaceId: string):
  Promise<Result<Plain, 'decrypt' | 'version' | 'shape'>>;
```

- AES-GCM, with a random 12-byte IV and AAD `"readerlog/v1/" + spaceId + "/" + batchId`.
- The plaintext is gzip-compressed JSON. The first ciphertext byte after decryption is
  a flags byte: `1` means gzip, `0` means raw.
- A `v` greater than 1 gives `'version'`. The engine stops advancing the cursor and
  reports `newerVersion`.

## Merge (core, pure)

```ts
function hlcReceive(local: Hlc | null, remote: Hlc, wallMs: number, deviceId: DeviceId): Hlc;
function parseRemoteOp(w: OpWire, device: string): Result<RemoteOp, ParseError>;   // table/field allow-list, HLC shape
function mergeOp(clockOf: (field: string) => Hlc | null, op: RemoteOp): string[];   // winning field names
```

Invariants (property tests, `packages/core/test/merge.property.test.ts`):

1. **`mergeOp`.** A field wins if and only if its clock is null or `op.hlc > clock`.
2. **`hlcReceive`.** The result is greater than `local` and greater than `remote`, and
   its millisecond part is at least `max(local.ms, remote.ms, wallMs)`.
3. **Order independence.** Applying any permutation of a set of ops field by field gives
   the same final `(value, clock)` per field.

## Apply (db, `packages/db/src/sync.ts`)

```ts
function applyRemoteOps(db: Database, ops: readonly RemoteOp[], deviceId: DeviceId, wallMs: () => number):
  { applied: number; skipped: number; parked: number };
function unpushedOps(db: Database, limit: number): { maxSeq: number; ops: OpWire[] };
function markPushed(db: Database, maxSeq: number): void;
function resetPushState(db: Database): void;          // pushed = 0 on every row; cursor = 0
function syncMeta(db): SyncMeta; function setSyncMeta(db, patch: Partial<SyncMeta>): void;
```

`applyRemoteOps` runs in one SAVEPOINT. Per op:

1. **Skip** it if `op_id` is already in `change_log`.
2. **Park** it in `sync_inbox` if the row is missing and the op can't create it:
   - `items` needs `type`, `title` and `created_at`;
   - `reading_events` needs `item_id`, `event_type`, `occurred_at` and `local_date`;
   - `duplicate_dismissals` needs `item_a`, `item_b` and `created_at`.
3. **Otherwise**:
   - upsert the winning fields;
   - set their `field_clock` entries;
   - insert into `change_log` with the op's own `op_id`, `hlc` and `device_id`, and
     `pushed = 1`;
   - advance `meta.hlc` with `hlcReceive`.

After the loop, retry `sync_inbox` until a pass applies nothing. Any exception rolls
everything back (FR-012).

**Local writes are unchanged.** `applyChanges` (001) still stamps new local ops with
`hlcNext(meta.hlc)`, and `meta.hlc` already reflects everything received.

## Engine (`packages/sync/src/engine.ts`, runs in the DB worker)

```ts
interface SyncDeps { db: ReaderlogDb; fetch: typeof fetch; now: () => number; random: (n: number) => Uint8Array; online: () => boolean }
function createSyncEngine(deps: SyncDeps): {
  status(): SyncStatusView;
  turnOn(): Promise<Result<{ code: string; qr: string }, SyncError>>;
  join(code: string): Promise<Result<{ duplicates: number }, SyncError>>;
  leave(): void;
  reset(): Promise<Result<{ code: string; qr: string }, SyncError>>;
  showCode(): { code: string; qr: string } | null;
  run(reason: 'start' | 'visible' | 'online' | 'write' | 'manual', opts?: { pushOnly?: boolean }): Promise<SyncRunResult>;   // pushOnly: capture-only peers (FR-025)
};
type SyncError = { kind: 'format' | 'checksum' | 'notFound' | 'offline' | 'relay'; status?: number };
interface SyncStatusView { on: boolean; lastOkAt: string | null; pending: number; problem: SyncProblem | null; undecryptable: number; inboxStuck: number }
interface SyncRunResult { pulled: number; pushed: number; changed: boolean }
```

The run order (research R6) is: first retry `pending_batch`, then pull all, then push
all.
