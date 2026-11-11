import type { Database } from '@sqlite.org/sqlite-wasm';

/**
 * The sync bookkeeping tables, for a new app to put at the start of its migration 1. Lector's own
 * migrations spell the same tables out (they are already applied on devices and can't change);
 * a lector-db test keeps the two equivalent.
 */
export const SYNC_BOOKKEEPING_DDL = `
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

  CREATE INDEX idx_changelog_unpushed ON change_log(seq)                     WHERE pushed = 0;

  -- Local only: remote ops that can't be applied yet. Never in change_log.
  CREATE TABLE sync_inbox (
    op_id       TEXT PRIMARY KEY,
    hlc         TEXT NOT NULL,
    device_id   TEXT NOT NULL,
    tbl         TEXT NOT NULL,
    row_id      TEXT NOT NULL,
    fields_json TEXT NOT NULL
  );
`;

/**
 * Forward-only migrations keyed on PRAGMA user_version: `list[i]` takes the DB from version i to
 * i + 1, each in its own transaction. `to` stops early (test hook for an older-version fixture).
 */
export function runMigrations(db: Database, list: readonly string[], opts: { to?: number } = {}): void {
  db.exec('PRAGMA foreign_keys = ON');
  const current = Number(db.selectValue('PRAGMA user_version') ?? 0);
  for (let v = current; v < (opts.to ?? list.length); v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(list[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
