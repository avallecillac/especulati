import type { Database } from '@sqlite.org/sqlite-wasm';
import { runMigrations, SYNC_BOOKKEEPING_DDL } from '@especulati/db-kit';

/** Schema v1 (design D2): the three synced tables, the local-only poster cache, and the shared bookkeeping. */
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

export const MIGRATIONS: readonly string[] = [SYNC_BOOKKEEPING_DDL + MIGRATION_1];
export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Database): void {
  runMigrations(db, MIGRATIONS);
}
