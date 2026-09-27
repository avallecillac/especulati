# Contract: Database schema v1 (packages/db)

Migration 1 runs when `PRAGMA user_version = 0`, and sets it to 1. Migrations only
move forward, and each one runs in a single transaction.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE items (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('book','article')),
  title           TEXT NOT NULL CHECK (length(trim(title)) > 0),
  author          TEXT,
  isbn            TEXT,
  total_pages     INTEGER CHECK (total_pages IS NULL OR total_pages > 0),
  genre           TEXT,
  cover_url       TEXT,
  cover_blob_key  TEXT,
  url             TEXT,
  domain          TEXT,
  word_count      INTEGER CHECK (word_count IS NULL OR word_count >= 0),
  read_on         TEXT,
  metadata_status TEXT NOT NULL DEFAULT 'ok' CHECK (metadata_status IN ('pending','ok','failed')),
  rating          INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  created_at      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE TABLE reading_events (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id),
  event_type  TEXT NOT NULL CHECK (event_type IN ('started','progress','finished','abandoned')),
  page        INTEGER CHECK (page IS NULL OR (page > 0 AND event_type = 'progress')),
  occurred_at TEXT NOT NULL,
  local_date  TEXT NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  deleted_at  TEXT
);

CREATE TABLE tags      (id TEXT PRIMARY KEY, name TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE item_tags (item_id TEXT NOT NULL, tag_id TEXT NOT NULL, deleted_at TEXT,
                        PRIMARY KEY (item_id, tag_id));

CREATE TABLE field_clock (
  tbl TEXT NOT NULL, row_id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL,
  PRIMARY KEY (tbl, row_id, field)
) WITHOUT ROWID;

CREATE TABLE change_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id       TEXT NOT NULL UNIQUE,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  tbl         TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  pushed      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;

CREATE INDEX idx_events_item_date ON reading_events(item_id, local_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_date      ON reading_events(local_date)          WHERE deleted_at IS NULL;
CREATE INDEX idx_items_type_read  ON items(type, read_on)                WHERE deleted_at IS NULL;
CREATE INDEX idx_changelog_unpushed ON change_log(seq) WHERE pushed = 0;
```

**Notes**

- Tags exist in the schema so that migration 1 is complete, but this feature has no
  UI for them.
- `CHECK` constraints are a second line of defense. The core rejects invalid input
  before it ever reaches SQL.

## Apply contract (`applyChanges(db, changes, deviceId, wallMs, newOpId)`)

`wallMs: () => number` and `newOpId: () => string` are injected: `Date.now` and
`crypto.randomUUID` in the app, and deterministic fakes in tests.

It runs inside one `BEGIN IMMEDIATE … COMMIT`. For each change, in order:

1. Compute `hlc = hlcNext(meta.hlc, wallMs(), deviceId)`.
2. Upsert the row:
   `INSERT … ON CONFLICT(id) DO UPDATE SET <only fields in change>`.
3. For each field, upsert `field_clock(tbl,row_id,field,hlc)`.
4. Insert `change_log(op_id = newOpId(), hlc, device_id, tbl, row_id, fields_json)`.
5. After the loop, write `meta.hlc`.

Any error rolls back the whole transaction, leaving the rows, `field_clock`,
`change_log`, and `meta` unchanged (FR-010).

**Tested invariants**

1. The number of `change_log` rows added equals the number of changes applied.
2. Every `(tbl,row_id,field)` in a change has a `field_clock` entry equal to that
   change's HLC.
3. HLCs strictly increase in `seq` order.
4. A failure injected after change *k* leaves the database byte-identical to the
   pre-transaction state, compared with a logical dump.
