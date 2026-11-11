import { compareHlc, err, ok, type Result } from '@especulati/sync-core';
import type { Change, ClockedRating, ClockedRecommendation, ClockedTitle, Command, Decision, FieldClocks, FieldValue, ReconcileSnapshot, Rejection } from './commands.ts';
import { genresToDb, type TitleRow } from './rows.ts';
import { parseMemberId, parseTitleId } from './types.ts';

type Decided = Result<Decision, Rejection>;
const bad = (field: string, reason: string): Rejection => ({ kind: 'InvalidInput', field, reason });

/** Shared title fields merged by greater HLC, by DB column (D4). `kind`, `added_by`, `created_at` and `merged_into` are not. */
const TITLE_FIELDS: readonly (readonly [string, (t: TitleRow) => FieldValue])[] = [
  ['title', (t) => t.title], ['original_title', (t) => t.originalTitle], ['year', (t) => t.year], ['tmdb_id', (t) => t.tmdbId],
  ['poster_url', (t) => t.posterUrl], ['genres', (t) => genresToDb(t.genres)], ['runtime_min', (t) => t.runtimeMin],
  ['season_count', (t) => t.seasonCount], ['status', (t) => t.status], ['watched_on', (t) => t.watchedOn],
  ['current_season', (t) => t.currentSeason], ['deleted_at', (t) => t.deletedAt],
];

/** The loser's value is copied when it has a clock and either the survivor has none or the loser's is greater. */
const loserWins = (l: ClockedTitle['clocks'], s: ClockedTitle['clocks'], field: string): boolean => {
  const lc = l[field];
  if (lc === undefined) return false;
  const sc = s[field];
  return sc === undefined || compareHlc(lc, sc) === 1;
};

const byId = (a: { row: { memberId: string } }, b: { row: { memberId: string } }) =>
  a.row.memberId < b.row.memberId ? -1 : a.row.memberId > b.row.memberId ? 1 : 0;

const byMember = (a: { row: { memberId: string } }, b: { row: { memberId: string } }) => byId(a, b);

/** Fields of a loser row to copy onto the survivor's (or onto a new row): those the loser wrote later, or the survivor never did. */
function carryFields<R extends { row: object; clocks: FieldClocks }>(
  lr: R, sr: R | undefined, cols: readonly (readonly [string, (r: R['row']) => FieldValue])[],
): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  for (const [col, get] of cols) {
    const lv = get(lr.row);
    if (loserWins(lr.clocks, sr?.clocks ?? {}, col) && (sr === undefined || lv !== get(sr.row))) fields[col] = lv;
  }
  return fields;
}

/**
 * Design D4. Deterministic: no clock, no randomness, no `now`; every list is processed in id order, so
 * each device deciding the same pair emits the same changes. The loser is not tombstoned: it gets
 * `merged_into`, and stays an input so a late edit to it is carried over on the next pass.
 */
export function reconcileTitles(snap: ReconcileSnapshot | null, cmd: Extract<Command, { kind: 'ReconcileTitles' }>): Decided {
  const a = parseTitleId(cmd.titleA);
  if (!a.ok) return err(bad(a.error.field, a.error.reason));
  const b = parseTitleId(cmd.titleB);
  if (!b.ok) return err(bad('titleId', b.error.reason));
  if (!snap || !snap.first || !snap.second) return err({ kind: 'NotFound' });
  if (snap.first.row.id !== a.value || snap.second.row.id !== b.value) return err(bad('reconcile', 'snapshot rows do not match the command'));
  if (a.value === b.value) return err(bad('titleB', 'same as titleA'));
  const { first, second } = snap;
  if (first.row.kind !== second.row.kind) return err(bad('kind', 'titles differ in kind'));
  if (first.row.tmdbId === null || first.row.tmdbId !== second.row.tmdbId) return err(bad('tmdbId', 'titles do not share a TMDB id'));

  const survivorIsFirst = cmd.tmdbTitleId === first.row.id ? true : cmd.tmdbTitleId === second.row.id ? false : first.row.id < second.row.id;
  const survivor = survivorIsFirst ? first : second;
  const loser = survivorIsFirst ? second : first;
  if (survivor.row.mergedInto !== null) return err(bad('titleId', 'the survivor is merged into another title'));
  if (loser.row.mergedInto !== null && loser.row.mergedInto !== survivor.row.id) return err(bad('titleId', 'the loser is merged into another title'));

  const changes: Change[] = [];
  const titleFields: Record<string, FieldValue> = {};
  // A title can be in the catalog without being on Together (status null). A null never replaces a real status, and a
  // real one fills a survivor that is off Together; the date travels with the status it belongs to.
  const takeStatus = loser.row.status !== null && (survivor.row.status === null || loserWins(loser.clocks, survivor.clocks, 'status'));
  for (const [col, get] of TITLE_FIELDS) {
    if (col === 'status' ? !takeStatus : col === 'watched_on' ? !(takeStatus || (loser.row.status !== null && survivor.row.status !== null && loserWins(loser.clocks, survivor.clocks, col))) : !loserWins(loser.clocks, survivor.clocks, col)) continue;
    const v = get(loser.row);
    if (v !== get(survivor.row)) titleFields[col] = v;
  }
  if (Object.keys(titleFields).length > 0) changes.push({ tbl: 'titles', rowId: survivor.row.id, fields: titleFields });

  const live = (r: ClockedRating) => r.row.deletedAt === null;
  const loserRatings = snap.ratings.filter((r) => r.row.titleId === loser.row.id && live(r)).sort(byId);
  const survivorByMember = new Map(snap.ratings.filter((r) => r.row.titleId === survivor.row.id).map((r) => [r.row.memberId as string, r]));
  for (const lr of loserRatings) {
    const sr = survivorByMember.get(lr.row.memberId);
    const empty: ClockedRating['clocks'] = {};
    const fields: Record<string, FieldValue> = {};
    for (const [col, lv, sv] of [
      ['verdict', lr.row.verdict, sr?.row.verdict ?? null],
      ['review', lr.row.review, sr?.row.review ?? null],
    ] as const) {
      if (loserWins(lr.clocks, sr?.clocks ?? empty, col) && (sr === undefined || lv !== sv)) fields[col] = lv;
    }
    if (Object.keys(fields).length === 0) continue;
    let rowId: string;
    if (sr) {
      rowId = sr.row.id;
      if (lr.row.updatedAt > sr.row.updatedAt) fields['updated_at'] = lr.row.updatedAt;
    } else {
      const mid = parseMemberId(lr.row.memberId);
      if (!mid.ok) return err(bad('memberId', mid.error.reason));
      const given = cmd.ratingIds.find((x) => x.titleId === survivor.row.id && x.memberId === lr.row.memberId);
      if (!given) return err(bad('ratingIds', `missing the derived rating id of the survivor for member ${lr.row.memberId}`));
      rowId = given.ratingId;
      Object.assign(fields, { title_id: survivor.row.id, member_id: lr.row.memberId, updated_at: lr.row.updatedAt });
    }
    changes.push({ tbl: 'ratings', rowId, fields });
  }

  const toSurvivor = { survivor: survivor.row.id, loser: loser.row.id };
  const missing = (what: string, who: string) => err(bad(what, `missing the derived id of the survivor for ${who}`));

  // Personal statuses (D3): per member, by field clock, like ratings.
  const msIds = cmd.memberStatusIds ?? [];
  const loserStatuses = (snap.memberStatuses ?? []).filter((r) => r.row.titleId === toSurvivor.loser && r.row.deletedAt === null).sort(byMember);
  const survivorStatusByMember = new Map((snap.memberStatuses ?? []).filter((r) => r.row.titleId === toSurvivor.survivor).map((r) => [r.row.memberId as string, r]));
  for (const lr of loserStatuses) {
    const sr = survivorStatusByMember.get(lr.row.memberId);
    const fields = carryFields(lr, sr, [
      ['status', (r) => r.status], ['watched_on', (r) => r.watchedOn], ['current_season', (r) => r.currentSeason],
    ]);
    if (Object.keys(fields).length === 0) continue;
    let rowId: string;
    if (sr) {
      rowId = sr.row.id;
      if (lr.row.updatedAt > sr.row.updatedAt) fields['updated_at'] = lr.row.updatedAt;
    } else {
      const given = msIds.find((x) => x.titleId === toSurvivor.survivor && x.memberId === lr.row.memberId);
      if (!given) return missing('memberStatusIds', `member ${lr.row.memberId}`);
      rowId = given.id;
      Object.assign(fields, { title_id: toSurvivor.survivor, member_id: lr.row.memberId, updated_at: lr.row.updatedAt });
    }
    changes.push({ tbl: 'member_status', rowId, fields });
  }

  // Recommendations (D3): per (from, to), by field clock. Each field keeps its single writer.
  const recIds = cmd.recommendationIds ?? [];
  const pairKey = (r: ClockedRecommendation) => `${r.row.fromMember}|${r.row.toMember}`;
  const loserRecs = (snap.recommendations ?? []).filter((r) => r.row.titleId === toSurvivor.loser && r.row.deletedAt === null).sort((a, b) => (pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0));
  const survivorRecByPair = new Map((snap.recommendations ?? []).filter((r) => r.row.titleId === toSurvivor.survivor).map((r) => [pairKey(r), r]));
  for (const lr of loserRecs) {
    const sr = survivorRecByPair.get(pairKey(lr));
    const fields = carryFields(lr, sr, [
      ['withdrawn_at', (r) => r.withdrawnAt], ['answered', (r) => r.answered], ['answered_at', (r) => r.answeredAt],
    ]);
    if (Object.keys(fields).length === 0) continue;
    let rowId: string;
    if (sr) {
      rowId = sr.row.id;
    } else {
      const given = recIds.find((x) => x.titleId === toSurvivor.survivor && x.fromMember === lr.row.fromMember && x.toMember === lr.row.toMember);
      if (!given) return missing('recommendationIds', `${lr.row.fromMember} to ${lr.row.toMember}`);
      rowId = given.id;
      Object.assign(fields, { title_id: toSurvivor.survivor, from_member: lr.row.fromMember, to_member: lr.row.toMember, created_at: lr.row.createdAt });
    }
    changes.push({ tbl: 'recommendations', rowId, fields });
  }

  if (loser.row.mergedInto === null) changes.push({ tbl: 'titles', rowId: loser.row.id, fields: { merged_into: survivor.row.id } });
  return ok({ changes });
}
