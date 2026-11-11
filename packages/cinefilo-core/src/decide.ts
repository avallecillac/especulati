import { err, ok, type ParseError, type Result } from '@especulati/sync-core';
import type { Change, Command, Decision, FieldValue, Rejection, Snapshot, TitleDetails } from './commands.ts';
import { reconcileTitles } from './reconcile.ts';
import { genresToDb, type TitleRow } from './rows.ts';
import {
  fail, parseKind, parseLocalDate, parseMemberId, parseMemberName, parseRatingId, parseReview, parseSeason, parseStatus, parseTitle, parseTitleId, parseVerdict, REVIEW_MAX, type Instant, type Kind, type Status,
} from './types.ts';

type Decided = Result<Decision, Rejection>;

const invalid = (e: ParseError): Rejection => ({ kind: 'InvalidInput', field: e.field, reason: e.reason });
const decided = (changes: Change[]): Decided => ok({ changes });
const bad = (field: string, reason: string): Rejection => ({ kind: 'InvalidInput', field, reason });

/** Parse, or short-circuit with the mapped rejection. */
export function need<T>(r: Result<T, ParseError>, onError: (e: ParseError) => Rejection = invalid): Result<T, Rejection> {
  return r.ok ? r : err(onError(r.error));
}
const titleRejection = (e: ParseError): Rejection => (e.reason === 'required' ? { kind: 'TitleRequired' } : invalid(e));

function parseInt(field: string, n: number, min: number, max: number): Result<number, ParseError> {
  return Number.isInteger(n) && n >= min && n <= max ? ok(n) : fail(field, `must be a whole number from ${min} to ${max}`);
}
const parseYear = (n: number) => parseInt('year', n, 1850, 2200);
const parseTmdbId = (n: number) => parseInt('tmdbId', n, 1, 2_000_000_000);
const parseRuntime = (n: number) => parseInt('runtimeMin', n, 1, 10_000);
const parseSeasonCount = (n: number) => parseInt('seasonCount', n, 1, 1000);

function parseText(field: string, s: string | null, max: number): Result<string | null, ParseError> {
  const t = (s ?? '').trim();
  if (t === '') return ok(null);
  return [...t].length > max ? fail(field, `longer than ${max} characters`) : ok(t);
}
function parseGenres(g: readonly string[] | null): Result<string | null, ParseError> {
  if (g === null) return ok(null);
  if (!Array.isArray(g) || g.length > 50) return fail('genres', 'must be a list of at most 50 names');
  const names: string[] = [];
  for (const x of g) {
    const t = typeof x === 'string' ? x.trim() : '';
    if (t === '' || [...t].length > 100) return fail('genres', 'names must be 1 to 100 characters');
    names.push(t);
  }
  return ok(genresToDb(names));
}

/** Parse every detail present in `d` into DB-column fields. Absent (undefined) details are skipped. */
function detailFields(d: TitleDetails): Result<Record<string, FieldValue>, Rejection> {
  const out: Record<string, FieldValue> = {};
  const opt = <T>(v: T | null | undefined, col: string, parse: (v: T) => Result<FieldValue, ParseError>): Rejection | null => {
    if (v === undefined) return null;
    if (v === null) { out[col] = null; return null; }
    const r = parse(v);
    if (!r.ok) return invalid(r.error);
    out[col] = r.value;
    return null;
  };
  const rejection =
    opt(d.originalTitle, 'original_title', (v) => parseText('originalTitle', v, 500)) ??
    opt(d.year, 'year', parseYear) ??
    opt(d.posterUrl, 'poster_url', (v) => parseText('posterUrl', v, 300)) ??
    opt(d.genres, 'genres', parseGenres) ??
    opt(d.runtimeMin, 'runtime_min', parseRuntime) ??
    opt(d.seasonCount, 'season_count', parseSeasonCount);
  return rejection ? err(rejection) : ok(out);
}

/** Statuses a kind may hold (cinefilo-watchlist: watching and dropped are series only). */
export const statusAllowed = (kind: Kind, status: Status): boolean => kind === 'series' || status === 'later' || status === 'watched';

/** Status and watched_on together: set for watched and dropped, cleared otherwise (D5). */
export function statusFields(kind: Kind, status: Status, watchedOn: string | undefined): Result<Record<string, FieldValue>, Rejection> {
  if (!statusAllowed(kind, status)) return err(bad('status', `${status} is not allowed for a ${kind}`));
  if (status === 'watched' || status === 'dropped') {
    if (watchedOn === undefined) return err(bad('watchedOn', 'required for watched and dropped'));
    const d = need(parseLocalDate(watchedOn));
    if (!d.ok) return d;
    return ok({ status, watched_on: d.value });
  }
  return ok({ status, watched_on: null });
}

/** The row a command may edit: present, not removed, not merged away. */
const liveTitle = (s: TitleRow | null | undefined): TitleRow | null => (s && s.deletedAt === null && s.mergedInto === null ? s : null);

function addTitle(snap: Snapshot, cmd: Extract<Command, { kind: 'AddTitle' }>, now: Instant): Decided {
  const id = need(parseTitleId(cmd.titleId));
  if (!id.ok) return id;
  const added = need(parseMemberId(cmd.addedBy));
  if (!added.ok) return added;
  const mk = need(parseKind(cmd.mediaKind));
  if (!mk.ok) return mk;
  const existing = snap.title ?? null;
  if (existing && existing.deletedAt === null) return err({ kind: 'AlreadyExists', id: existing.mergedInto ?? existing.id });
  const title = need(parseTitle(cmd.title), titleRejection);
  if (!title.ok) return title;
  const details = detailFields(cmd);
  if (!details.ok) return details;
  const status = need(parseStatus(cmd.status ?? 'later'));
  if (!status.ok) return status;
  const st = statusFields(mk.value, status.value, cmd.watchedOn);
  if (!st.ok) return st;
  const fields: Record<string, FieldValue> = { kind: mk.value, title: title.value, ...details.value, ...st.value, added_by: added.value, created_at: now };
  if (cmd.tmdbId !== undefined && cmd.tmdbId !== null) {
    const t = need(parseTmdbId(cmd.tmdbId));
    if (!t.ok) return t;
    fields['tmdb_id'] = t.value;
  }
  // A removed row with this derived id is revived: a fresh insert under another id is impossible.
  if (existing) fields['deleted_at'] = null;
  return decided([{ tbl: 'titles', rowId: id.value, fields }]);
}

function editDetails(snap: Snapshot, cmd: Extract<Command, { kind: 'EditTitleDetails' }>): Decided {
  const id = need(parseTitleId(cmd.titleId));
  if (!id.ok) return id;
  if (!liveTitle(snap.title)) return err({ kind: 'NotFound' });
  const fields: Record<string, FieldValue> = {};
  if (cmd.title !== undefined) {
    const t = need(parseTitle(cmd.title), titleRejection);
    if (!t.ok) return t;
    fields['title'] = t.value;
  }
  const details = detailFields(cmd);
  if (!details.ok) return details;
  Object.assign(fields, details.value);
  return decided(Object.keys(fields).length === 0 ? [] : [{ tbl: 'titles', rowId: id.value, fields }]);
}

/** D4 (a): keep the row id, set tmdb_id and fill only details that are still empty. */
function linkToTmdb(snap: Snapshot, cmd: Extract<Command, { kind: 'LinkToTmdb' }>): Decided {
  const id = need(parseTitleId(cmd.titleId));
  if (!id.ok) return id;
  const t = liveTitle(snap.title);
  if (!t) return err({ kind: 'NotFound' });
  const tid = need(parseTmdbId(cmd.tmdbId));
  if (!tid.ok) return tid;
  if (t.tmdbId !== null && t.tmdbId !== tid.value) return err(bad('tmdbId', 'already linked to another TMDB id'));
  const d = detailFields(cmd.details);
  if (!d.ok) return d;
  const empty: Record<string, boolean> = {
    original_title: t.originalTitle === null, year: t.year === null, poster_url: t.posterUrl === null, genres: t.genres === null,
    runtime_min: t.runtimeMin === null, season_count: t.seasonCount === null,
  };
  const fields: Record<string, FieldValue> = {};
  if (t.tmdbId === null) fields['tmdb_id'] = tid.value;
  for (const [k, v] of Object.entries(d.value)) if (empty[k] && v !== null) fields[k] = v;
  return decided(Object.keys(fields).length === 0 ? [] : [{ tbl: 'titles', rowId: t.id, fields }]);
}

function setRemoved(snap: Snapshot, cmd: { titleId: string }, deletedAt: Instant | null): Decided {
  const id = need(parseTitleId(cmd.titleId));
  if (!id.ok) return id;
  const t = snap.title ?? null;
  if (!t) return err({ kind: 'NotFound' });
  if ((t.deletedAt === null) === (deletedAt === null)) return decided([]);
  return decided([{ tbl: 'titles', rowId: id.value, fields: { deleted_at: deletedAt } }]);
}

function setStatus(snap: Snapshot, cmd: Extract<Command, { kind: 'SetStatus' }>): Decided {
  const id = need(parseTitleId(cmd.titleId));
  if (!id.ok) return id;
  const t = liveTitle(snap.title);
  if (!t) return err({ kind: 'NotFound' });
  const status = need(parseStatus(cmd.status));
  if (!status.ok) return status;
  const f = statusFields(t.kind, status.value, cmd.watchedOn);
  if (!f.ok) return f;
  return decided([{ tbl: 'titles', rowId: id.value, fields: f.value }]);
}

function setCurrentSeason(snap: Snapshot, cmd: Extract<Command, { kind: 'SetCurrentSeason' }>): Decided {
  const id = need(parseTitleId(cmd.titleId));
  if (!id.ok) return id;
  const t = liveTitle(snap.title);
  if (!t) return err({ kind: 'NotFound' });
  if (t.kind !== 'series') return err({ kind: 'NotASeries' });
  const season = need(parseSeason(cmd.season), () => ({ kind: 'SeasonOutOfRange', max: t.seasonCount }));
  if (!season.ok) return season;
  if (t.seasonCount !== null && season.value > t.seasonCount) return err({ kind: 'SeasonOutOfRange', max: t.seasonCount });
  return decided([{ tbl: 'titles', rowId: id.value, fields: { current_season: season.value } }]);
}

function ownRatingTarget(snap: Snapshot, cmd: { titleId: string; memberId: string; ratingId: string }): Result<{ titleId: string; memberId: string; ratingId: string }, Rejection> {
  const tid = need(parseTitleId(cmd.titleId));
  if (!tid.ok) return tid;
  const mid = need(parseMemberId(cmd.memberId));
  if (!mid.ok) return mid;
  const rid = need(parseRatingId(cmd.ratingId));
  if (!rid.ok) return rid;
  if (snap.deviceMemberId == null || snap.deviceMemberId !== mid.value) return err({ kind: 'NotYourRating' });
  if (!snap.member || snap.member.id !== mid.value || snap.member.deletedAt !== null) return err({ kind: 'UnknownMember' });
  if (!liveTitle(snap.title)) return err({ kind: 'NotFound' });
  return ok({ titleId: tid.value, memberId: mid.value, ratingId: snap.rating?.id ?? rid.value });
}

/** Insert carries the full key (title_id, member_id); later edits carry only what changes. */
function ratingChange(snap: Snapshot, t: { titleId: string; memberId: string; ratingId: string }, edit: Record<string, FieldValue>, now: Instant): Decided {
  const fields: Record<string, FieldValue> = snap.rating ? {} : { title_id: t.titleId, member_id: t.memberId };
  return decided([{ tbl: 'ratings', rowId: t.ratingId, fields: { ...fields, ...edit, updated_at: now } }]);
}

function setVerdict(snap: Snapshot, cmd: Extract<Command, { kind: 'SetVerdict' }>, now: Instant): Decided {
  const t = ownRatingTarget(snap, cmd);
  if (!t.ok) return t;
  let verdict: string | null = null;
  if (cmd.verdict !== null) {
    const v = need(parseVerdict(cmd.verdict));
    if (!v.ok) return v;
    verdict = v.value;
  }
  return ratingChange(snap, t.value, { verdict }, now);
}

function setReview(snap: Snapshot, cmd: Extract<Command, { kind: 'SetReview' }>, now: Instant): Decided {
  const t = ownRatingTarget(snap, cmd);
  if (!t.ok) return t;
  const review = need(parseReview(cmd.review), () => ({ kind: 'TooLong', field: 'review', max: REVIEW_MAX }));
  if (!review.ok) return review;
  return ratingChange(snap, t.value, { review: review.value }, now);
}

function createMember(snap: Snapshot, cmd: Extract<Command, { kind: 'CreateMember' }>, now: Instant): Decided {
  const id = need(parseMemberId(cmd.memberId));
  if (!id.ok) return id;
  if (snap.member) return err({ kind: 'AlreadyExists', id: snap.member.id });
  const name = need(parseMemberName(cmd.name));
  if (!name.ok) return name;
  return decided([{ tbl: 'members', rowId: id.value, fields: { name: name.value, created_at: now } }]);
}

function renameMember(snap: Snapshot, cmd: Extract<Command, { kind: 'RenameMember' }>): Decided {
  const id = need(parseMemberId(cmd.memberId));
  if (!id.ok) return id;
  if (!snap.member || snap.member.deletedAt !== null) return err({ kind: 'UnknownMember' });
  const name = need(parseMemberName(cmd.name));
  if (!name.ok) return name;
  return decided([{ tbl: 'members', rowId: id.value, fields: { name: name.value } }]);
}

function removeMember(snap: Snapshot, cmd: Extract<Command, { kind: 'RemoveMember' }>, now: Instant): Decided {
  const id = need(parseMemberId(cmd.memberId));
  if (!id.ok) return id;
  if (!snap.member) return err({ kind: 'UnknownMember' });
  if (snap.member.deletedAt !== null) return decided([]);
  if (snap.deviceMemberId === id.value) return err(bad('memberId', 'this device acts as that member'));
  return decided([{ tbl: 'members', rowId: id.value, fields: { deleted_at: now } }]);
}

/** The single write path (constitution IV): pure, deterministic, no I/O. */
export function decide(snapshot: Snapshot, cmd: Command, now: Instant): Decided {
  switch (cmd.kind) {
    case 'AddTitle':
      return addTitle(snapshot, cmd, now);
    case 'EditTitleDetails':
      return editDetails(snapshot, cmd);
    case 'LinkToTmdb':
      return linkToTmdb(snapshot, cmd);
    case 'RemoveTitle':
      return setRemoved(snapshot, cmd, now);
    case 'RestoreTitle':
      return setRemoved(snapshot, cmd, null);
    case 'SetStatus':
      return setStatus(snapshot, cmd);
    case 'SetCurrentSeason':
      return setCurrentSeason(snapshot, cmd);
    case 'SetVerdict':
      return setVerdict(snapshot, cmd, now);
    case 'SetReview':
      return setReview(snapshot, cmd, now);
    case 'CreateMember':
      return createMember(snapshot, cmd, now);
    case 'RenameMember':
      return renameMember(snapshot, cmd);
    case 'RemoveMember':
      return removeMember(snapshot, cmd, now);
    case 'ReconcileTitles':
      return reconcileTitles(snapshot.reconcile ?? null, cmd);
  }
}
