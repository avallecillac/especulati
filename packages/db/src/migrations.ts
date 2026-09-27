import type { Database } from '@sqlite.org/sqlite-wasm';

/** Forward-only migrations keyed on PRAGMA user_version (contracts/db-schema.md). */
const MIGRATIONS: readonly string[] = [
  /* 1 */ `
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

  CREATE INDEX idx_events_item_date   ON reading_events(item_id, local_date) WHERE deleted_at IS NULL;
  CREATE INDEX idx_events_date        ON reading_events(local_date)          WHERE deleted_at IS NULL;
  CREATE INDEX idx_items_type_read    ON items(type, read_on)                WHERE deleted_at IS NULL;
  CREATE INDEX idx_changelog_unpushed ON change_log(seq)                     WHERE pushed = 0;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON');
  const current = Number(db.selectValue('PRAGMA user_version') ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
