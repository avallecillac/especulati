import type { Database } from '@sqlite.org/sqlite-wasm';
import {
  cinefiloSchema, genresToDb, parseExport, serializeExport, EXPORT_FORMAT,
  type Change, type CinefiloExport, type Instant, type ParseError, type Result, err, ok,
} from '@especulati/cinefilo-core';
import { applyChanges, rollbackQuietly } from '@especulati/db-kit';
import type { DeviceId } from '@especulati/sync-core';
import { rowToMember, rowToMemberStatus, rowToRating, rowToRecommendation, rowToTitle } from './snapshot.ts';

/** Everything the `cinefilo/v1` file holds: all titles (removed and merged too), members, ratings, personal statuses and recommendations. Never meta, posters or keys. */
export function exportData(db: Database, exportedAt: Instant): CinefiloExport {
  return {
    format: EXPORT_FORMAT,
    exportedAt,
    titles: db.selectObjects('SELECT * FROM titles ORDER BY id').map(rowToTitle),
    members: db.selectObjects('SELECT * FROM members ORDER BY id').map(rowToMember),
    ratings: db.selectObjects('SELECT * FROM ratings ORDER BY id').map(rowToRating),
    memberStatus: db.selectObjects('SELECT * FROM member_status ORDER BY id').map(rowToMemberStatus),
    recommendations: db.selectObjects('SELECT * FROM recommendations ORDER BY id').map(rowToRecommendation),
  };
}

export const exportText = (db: Database, exportedAt: Instant): string => serializeExport(exportData(db, exportedAt));

export interface ImportResult {
  /** Rows the file had that this database did not, now inserted. */
  readonly added: number;
  /** Rows already present: left as they are (the file never overwrites newer local edits). */
  readonly present: number;
}

/**
 * Merge a file by id, all or nothing: rows this database lacks are inserted as local writes (so they get
 * clocks and are pushed to the space); rows it already has are left alone. Importing the same file twice is
 * therefore a no-op, and a file never overwrites newer edits. The file is validated completely first.
 */
export function importText(
  db: Database, text: string, deviceId: DeviceId, wallMs: () => number, newOpId: () => string,
): Result<ImportResult, ParseError> {
  const parsed = parseExport(text);
  if (!parsed.ok) return err(parsed.error);
  const f = parsed.value;
  const missing = (tbl: string, id: string) => db.selectValue(`SELECT 1 FROM ${tbl} WHERE id = ?`, [id]) === undefined;
  const changes: Change[] = [];
  let present = 0;
  for (const t of f.titles) {
    if (!missing('titles', t.id)) { present++; continue; }
    changes.push({
      tbl: 'titles', rowId: t.id,
      fields: {
        kind: t.kind, title: t.title, original_title: t.originalTitle, year: t.year, tmdb_id: t.tmdbId, poster_url: t.posterUrl,
        genres: genresToDb(t.genres), runtime_min: t.runtimeMin, season_count: t.seasonCount, status: t.status, watched_on: t.watchedOn,
        current_season: t.currentSeason, ...(t.watchOrder !== null ? { watch_order: t.watchOrder } : {}), merged_into: t.mergedInto, added_by: t.addedBy,
        created_at: t.createdAt, deleted_at: t.deletedAt,
      },
    });
  }
  for (const m of f.members) {
    if (!missing('members', m.id)) { present++; continue; }
    changes.push({ tbl: 'members', rowId: m.id, fields: { name: m.name, created_at: m.createdAt, deleted_at: m.deletedAt } });
  }
  for (const r of f.ratings) {
    if (!missing('ratings', r.id)) { present++; continue; }
    changes.push({
      tbl: 'ratings', rowId: r.id,
      fields: { title_id: r.titleId, member_id: r.memberId, verdict: r.verdict, ...(r.stars !== null ? { stars: r.stars } : {}), review: r.review, updated_at: r.updatedAt, deleted_at: r.deletedAt },
    });
  }
  for (const s of f.memberStatus) {
    if (!missing('member_status', s.id)) { present++; continue; }
    changes.push({
      tbl: 'member_status', rowId: s.id,
      fields: { title_id: s.titleId, member_id: s.memberId, status: s.status, watched_on: s.watchedOn, current_season: s.currentSeason, updated_at: s.updatedAt, deleted_at: s.deletedAt },
    });
  }
  for (const r of f.recommendations) {
    if (!missing('recommendations', r.id)) { present++; continue; }
    changes.push({
      tbl: 'recommendations', rowId: r.id,
      fields: {
        title_id: r.titleId, from_member: r.fromMember, to_member: r.toMember, created_at: r.createdAt, withdrawn_at: r.withdrawnAt,
        answered: r.answered, answered_at: r.answeredAt, deleted_at: r.deletedAt,
      },
    });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    applyChanges(db, cinefiloSchema, changes, deviceId, wallMs, newOpId);
    db.exec('COMMIT');
  } catch (e) {
    rollbackQuietly(db, 'ROLLBACK');
    throw e;
  }
  return ok({ added: changes.length, present });
}
