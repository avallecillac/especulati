import type { Database } from '@sqlite.org/sqlite-wasm';
import { runMigrations, SYNC_BOOKKEEPING_DDL } from '@especulati/db-kit';

/** Schema v1 (add-cinefilo design D2): the three synced tables, the local-only poster cache, and the shared bookkeeping. */
const MIGRATION_1 = `
  CREATE TABLE titles (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL CHECK (kind IN ('movie','series')),
    title          TEXT NOT NULL,
    original_title TEXT,
    year           INTEGER,
    tmdb_id        INTEGER,
    poster_url     TEXT,
    genres         TEXT,
    runtime_min    INTEGER,
    season_count   INTEGER,
    status         TEXT NOT NULL CHECK (status IN ('later','watching','watched','dropped')),
    watched_on     TEXT,
    current_season INTEGER,
    merged_into    TEXT,
    added_by       TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    deleted_at     TEXT
  );

  CREATE TABLE members (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT
  );

  CREATE TABLE ratings (
    id         TEXT PRIMARY KEY,
    title_id   TEXT NOT NULL,
    member_id  TEXT NOT NULL,
    verdict    TEXT CHECK (verdict IN ('like','meh','dislike')),
    review     TEXT CHECK (review IS NULL OR length(review) <= 1000),
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  -- Local only: never in change_log.
  CREATE TABLE posters (
    title_id   TEXT PRIMARY KEY,
    mime       TEXT NOT NULL,
    bytes      BLOB NOT NULL,
    fetched_at TEXT NOT NULL
  );

  CREATE INDEX idx_titles_status ON titles(status, watched_on) WHERE deleted_at IS NULL AND merged_into IS NULL;
  CREATE INDEX idx_titles_tmdb   ON titles(tmdb_id, kind)     WHERE deleted_at IS NULL AND merged_into IS NULL;
  -- ratings have no merged_into column: live rows only.
  CREATE INDEX idx_ratings_title ON ratings(title_id)         WHERE deleted_at IS NULL;
`;

/**
 * Schema v2 (personal-lists D1, D3, D4). `titles.status` becomes nullable (NULL = in the catalog, not on Together),
 * which SQLite can only do by rebuilding the table; then the two personal tables, and a one-time cursor reset so a
 * device that skipped tier-`p` batches on an older version re-reads the space once (ops it has are ignored by id).
 */
const MIGRATION_2 = `
  CREATE TABLE titles_v2 (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL CHECK (kind IN ('movie','series')),
    title          TEXT NOT NULL,
    original_title TEXT,
    year           INTEGER,
    tmdb_id        INTEGER,
    poster_url     TEXT,
    genres         TEXT,
    runtime_min    INTEGER,
    season_count   INTEGER,
    status         TEXT CHECK (status IS NULL OR status IN ('later','watching','watched','dropped')),
    watched_on     TEXT,
    current_season INTEGER,
    merged_into    TEXT,
    added_by       TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    deleted_at     TEXT
  );
  INSERT INTO titles_v2 SELECT id, kind, title, original_title, year, tmdb_id, poster_url, genres, runtime_min, season_count,
    status, watched_on, current_season, merged_into, added_by, created_at, deleted_at FROM titles;
  DROP TABLE titles;
  ALTER TABLE titles_v2 RENAME TO titles;
  CREATE INDEX idx_titles_status ON titles(status, watched_on) WHERE deleted_at IS NULL AND merged_into IS NULL;
  CREATE INDEX idx_titles_tmdb   ON titles(tmdb_id, kind)     WHERE deleted_at IS NULL AND merged_into IS NULL;

  CREATE TABLE member_status (
    id             TEXT PRIMARY KEY,
    title_id       TEXT NOT NULL,
    member_id      TEXT NOT NULL,
    status         TEXT CHECK (status IN ('later','watching','watched')),
    watched_on     TEXT,
    current_season INTEGER,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT
  );
  CREATE TABLE recommendations (
    id           TEXT PRIMARY KEY,
    title_id     TEXT NOT NULL,
    from_member  TEXT NOT NULL,
    to_member    TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    withdrawn_at TEXT,
    answered     TEXT CHECK (answered IN ('accepted','dismissed')),
    answered_at  TEXT,
    deleted_at   TEXT
  );
  CREATE INDEX idx_member_status_list ON member_status(member_id, status) WHERE deleted_at IS NULL;
  CREATE INDEX idx_member_status_title ON member_status(title_id) WHERE deleted_at IS NULL;
  CREATE INDEX idx_recs_to ON recommendations(to_member) WHERE answered IS NULL AND withdrawn_at IS NULL;
  CREATE INDEX idx_recs_title ON recommendations(title_id) WHERE deleted_at IS NULL;

  -- Re-read the whole space once, so batches an older version skipped (tier p) are applied.
  UPDATE meta SET value = '0' WHERE key = 'sync_cursor';
  UPDATE meta SET value = json_set(value, '$.undecryptable', 0) WHERE key = 'sync_status' AND json_valid(value);
`;

export const MIGRATIONS: readonly string[] = [SYNC_BOOKKEEPING_DDL + MIGRATION_1, MIGRATION_2];
export const SCHEMA_VERSION = MIGRATIONS.length;

/** `to` stops early (test hook for building an older-version fixture). */
export function migrate(db: Database, opts: { to?: number } = {}): void {
  runMigrations(db, MIGRATIONS, opts);
}
