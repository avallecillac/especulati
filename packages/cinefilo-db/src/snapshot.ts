import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import {
  genresFromDb,
  type ClockedRating, type ClockedTitle, type Command, type FieldClocks, type Hlc, type Instant, type Kind, type LocalDate,
  type MemberId, type MemberName, type MemberRow, type NonEmptyTitle, type RatingId, type RatingRow, type ReconcileSnapshot, type Review, type Snapshot,
  type Status, type TitleId, type TitleRow, type Verdict,
} from '@especulati/cinefilo-core';

// Rows were validated by decide() / parseRemoteOp before they were written and CHECK constraints guard the
// tables, so mapping them back to branded types is a trusted cast at this boundary. The converters still
// check the SQL storage class, so a schema mismatch fails loudly.
export function text(v: SqlValue | undefined, col: string): string {
  if (typeof v !== 'string') throw new TypeError(`column ${col}: expected TEXT, got ${typeof v}`);
  return v;
}
export const textOrNull = (v: SqlValue | undefined, col: string): string | null => (v === null || v === undefined ? null : text(v, col));
export function intOrNull(v: SqlValue | undefined, col: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number') throw new TypeError(`column ${col}: expected INTEGER, got ${typeof v}`);
  return v;
}

export function rowToTitle(r: Record<string, SqlValue>): TitleRow {
  return {
    id: text(r['id'], 'id') as TitleId,
    kind: text(r['kind'], 'kind') as Kind,
    title: text(r['title'], 'title') as NonEmptyTitle,
    originalTitle: textOrNull(r['original_title'], 'original_title'),
    year: intOrNull(r['year'], 'year'),
    tmdbId: intOrNull(r['tmdb_id'], 'tmdb_id'),
    posterUrl: textOrNull(r['poster_url'], 'poster_url'),
    genres: genresFromDb(textOrNull(r['genres'], 'genres')),
    runtimeMin: intOrNull(r['runtime_min'], 'runtime_min'),
    seasonCount: intOrNull(r['season_count'], 'season_count'),
    status: text(r['status'], 'status') as Status,
    watchedOn: textOrNull(r['watched_on'], 'watched_on') as LocalDate | null,
    currentSeason: intOrNull(r['current_season'], 'current_season'),
    mergedInto: textOrNull(r['merged_into'], 'merged_into') as TitleId | null,
    addedBy: text(r['added_by'], 'added_by') as MemberId,
    createdAt: text(r['created_at'], 'created_at') as Instant,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
  };
}

export function rowToMember(r: Record<string, SqlValue>): MemberRow {
  return {
    id: text(r['id'], 'id') as MemberId,
    name: text(r['name'], 'name') as MemberName,
    createdAt: text(r['created_at'], 'created_at') as Instant,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
  };
}

export function rowToRating(r: Record<string, SqlValue>): RatingRow {
  return {
    id: text(r['id'], 'id') as RatingId,
    titleId: text(r['title_id'], 'title_id') as TitleId,
    memberId: text(r['member_id'], 'member_id') as MemberId,
    verdict: textOrNull(r['verdict'], 'verdict') as Verdict | null,
    review: textOrNull(r['review'], 'review') as Review | null,
    updatedAt: text(r['updated_at'], 'updated_at') as Instant,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
  };
}

const one = <T>(db: Database, sql: string, id: string, map: (r: Record<string, SqlValue>) => T): T | null => {
  const r = db.selectObject(sql, [id]);
  return r ? map(r) : null;
};
export const titleRow = (db: Database, id: string): TitleRow | null => one(db, 'SELECT * FROM titles WHERE id = ?', id, rowToTitle);
export const memberRow = (db: Database, id: string): MemberRow | null => one(db, 'SELECT * FROM members WHERE id = ?', id, rowToMember);
export const ratingRow = (db: Database, id: string): RatingRow | null => one(db, 'SELECT * FROM ratings WHERE id = ?', id, rowToRating);

function clocksOf(db: Database, tbl: string, rowId: string): FieldClocks {
  const out: Record<string, Hlc> = {};
  for (const r of db.selectObjects('SELECT field, hlc FROM field_clock WHERE tbl = ? AND row_id = ?', [tbl, rowId])) {
    out[text(r['field'], 'field')] = text(r['hlc'], 'hlc') as Hlc;
  }
  return out;
}

const clockedTitle = (db: Database, id: string): ClockedTitle | null => {
  const row = titleRow(db, id);
  return row ? { row, clocks: clocksOf(db, 'titles', id) } : null;
};

/** The pair of titles and every rating row on either (any state), each with its field clocks. */
export function loadReconcileSnapshot(db: Database, titleA: string, titleB: string): ReconcileSnapshot {
  const ratings: ClockedRating[] = db
    .selectObjects('SELECT * FROM ratings WHERE title_id IN (?, ?) ORDER BY id', [titleA, titleB])
    .map(rowToRating)
    .map((row) => ({ row, clocks: clocksOf(db, 'ratings', row.id) }));
  return { first: clockedTitle(db, titleA), second: clockedTitle(db, titleB), ratings };
}

/** What `decide()` needs for `cmd`, read inside the dispatch transaction. */
export function loadSnapshot(db: Database, cmd: Command, deviceMemberId: string | null): Snapshot {
  switch (cmd.kind) {
    case 'AddTitle':
    case 'EditTitleDetails':
    case 'LinkToTmdb':
    case 'RemoveTitle':
    case 'RestoreTitle':
    case 'SetStatus':
    case 'SetCurrentSeason':
      return { title: titleRow(db, cmd.titleId) };
    case 'SetVerdict':
    case 'SetReview':
      return { title: titleRow(db, cmd.titleId), member: memberRow(db, cmd.memberId), rating: ratingRow(db, cmd.ratingId), deviceMemberId };
    case 'CreateMember':
    case 'RenameMember':
    case 'RemoveMember':
      return { member: memberRow(db, cmd.memberId), deviceMemberId };
    case 'ReconcileTitles':
      return { reconcile: loadReconcileSnapshot(db, cmd.titleA, cmd.titleB) };
  }
}
