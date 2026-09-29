# Data Model: Encrypted Sync (004)

## Device (SQLite, schema v3)

### Migration 3 (forward-only)

```sql
-- Synced: "Keep both" decisions (US5). A row per dismissed pair; id derived from the pair.
CREATE TABLE duplicate_dismissals (
  id         TEXT PRIMARY KEY,
  item_a     TEXT NOT NULL,          -- min(item ids)
  item_b     TEXT NOT NULL,          -- max(item ids)
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

-- Synced: set on a book merged away by MergeBooks (research R8, stragglers).
ALTER TABLE items ADD COLUMN merged_into TEXT;

-- Local only: remote ops that can't be applied yet (research R5). Never in change_log.
CREATE TABLE sync_inbox (
  op_id       TEXT PRIMARY KEY,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  tbl         TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  fields_json TEXT NOT NULL
);
```

**Existing tables used as-is:**

- `change_log`: `pushed` marks sent rows. Received ops are stored with their original
  `op_id`, `hlc` and `device_id`, and with `pushed = 1`.
- `field_clock`: the per-field last-writer-wins clock.

### `meta` keys (local only, never synced)

| Key | Value |
|---|---|
| `sync_key` | the 32-byte sync code, base64url. Absent means sync is off |
| `sync_cursor` | the last applied relay `seq` (integer string) |
| `pending_batch` | JSON `{ batchId, maxSeq }` while a push is in flight |
| `sync_status` | JSON `{ lastOkAt: Instant \| null, problem: SyncProblem \| null, undecryptable: number }` |
| `sync_old_space` | the old space id, while its DELETE after a reset is still owed |

`SyncProblem` is `'offline' | 'relay' | 'spaceGone' | 'unauthorized' | 'newerVersion' | 'corrupt'`.

## Core types (`packages/core`)

| Type | Rule |
|---|---|
| `RemoteOp` | `{ opId: string; hlc: Hlc; deviceId: DeviceId; tbl: Table; rowId: string; fields: Record<string, FieldValue> }`, parsed and validated: a known `tbl`, fields in the table's writable set, and a parseable HLC |
| `Table` | extended to include `'duplicate_dismissals'` |
| `DuplicatePair` | `{ survivor: ItemId; duplicate: ItemId; reason: 'isbn' \| 'titleAuthor' }` |

**Pure functions:**

- `hlcReceive(local: Hlc | null, remote: Hlc, wallMs: number, deviceId: DeviceId): Hlc`
  follows the standard HLC receive rule. The result is greater than both inputs.
- `mergeOp(clock: (field) => Hlc | null, op: RemoteOp): string[]` returns the winning
  fields.
- `normalizeForMatch(s: string): string`.
- `findDuplicates(books: { id; title; author; isbn; createdAt }[], dismissed: Set<pairKey>): DuplicatePair[]`.
  The survivor is the smaller `(createdAt, id)`.

## New commands

Details are in `contracts/commands-004.md`.

- `MergeBooks { survivorId, duplicateId, copies: { from: EventId; to: EventId }[] }`
- `DismissDuplicate { dismissalId, itemA, itemB }`

## Relay (D1, `apps/relay/schema.sql`)

```sql
CREATE TABLE spaces (
  space_id   TEXT PRIMARY KEY,          -- 32 hex chars, from HKDF (research R2)
  token_hash TEXT NOT NULL,             -- hex SHA-256 of the auth token
  created_at INTEGER NOT NULL           -- unix ms
);
CREATE TABLE batches (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id   TEXT NOT NULL,
  batch_id   TEXT NOT NULL,
  iv         TEXT NOT NULL,
  ct         TEXT NOT NULL,             -- base64url ciphertext, ≤ 1 MiB request
  created_at INTEGER NOT NULL,
  UNIQUE (space_id, batch_id)
);
CREATE INDEX idx_batches_space_seq ON batches(space_id, seq);
CREATE TABLE rate (
  space_id TEXT NOT NULL,
  minute   INTEGER NOT NULL,            -- floor(unix ms / 60000)
  count    INTEGER NOT NULL,
  PRIMARY KEY (space_id, minute)
);
```

The relay stores **no** plaintext, device ids, op ids, table names or row ids
(SC-005).
