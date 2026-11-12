import { err, ok, type ParseError, type Result } from '@especulati/sync-core';
import type { Change, Command, Decision, FieldValue, Rejection, Snapshot, TitleDetails } from './commands.ts';
import { reconcileTitles } from './reconcile.ts';
import { genresToDb, type TitleRow } from './rows.ts';
import {
  fail, parseAnswer, parseKind, parseLocalDate, parseMemberId, parseMemberName, parseMemberStatus, parseMemberStatusId, parseRatingId, parseRecommendationId, parseReview, parseSeason,
  parseStatus, parseTitle, parseTitleId, parseStars, REVIEW_MAX, type Instant, type Kind, type Status,
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

/** Status and watched_on together: set for watched and dropped, cleared otherwise (D5). Watched may have no date (unknown). */
export function statusFields(kind: Kind, status: Status, watchedOn: string | undefined): Result<Record<string, FieldValue>, Rejection> {
  if (!statusAllowed(kind, status)) return err(bad('status', `${status} is not allowed for a ${kind}`));
  if (status === 'watched' && watchedOn === undefined) return ok({ status, watched_on: null });
  if (status === 'watched' || status === 'dropped') {
    if (watchedOn === undefined) return err(bad('watchedOn', 'required for dropped'));
    const d = need(parseLocalDate(watchedOn));
    if (!d.ok) return d;
    return ok({ status, watched_on: d.value });
  }
  return ok({ status, watched_on: null });
}

/**
 * D2: the history place that goes with a Together status. Watched with no place yet takes max + 1; any other status
 * clears a place the title holds. Nothing is written when there is nothing to change.
 */
export function watchOrderFields(status: Status, current: number | null, max: number | null | undefined): Record<string, FieldValue> {
  if (status === 'watched') return current === null ? { watch_order: (max ?? 0) + 1 } : {};
  return current !== null ? { watch_order: null } : {};
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
  if (cmd.to === 'me') return addJustMe(snap, cmd, id.value, added.value, mk.value, now);
  if (existing && existing.deletedAt === null) {
    if (existing.mergedInto !== null || existing.status !== null) return err({ kind: 'AlreadyExists', id: existing.mergedInto ?? existing.id });
    // In the catalog but not on Together (it was added "Just me"): adding it to Together sets its status.
    const s = need(parseStatus(cmd.status ?? 'later'));
    if (!s.ok) return s;
    const f = statusFields(existing.kind, s.value, cmd.watchedOn);
    return f.ok ? decided([{ tbl: 'titles', rowId: existing.id, fields: { ...f.value, ...watchOrderFields(s.value, existing.watchOrder, snap.maxWatchOrder) } }]) : f;
  }
  const title = need(parseTitle(cmd.title), titleRejection);
  if (!title.ok) return title;
  const details = detailFields(cmd);
  if (!details.ok) return details;
  const status = need(parseStatus(cmd.status ?? 'later'));
  if (!status.ok) return status;
  const st = statusFields(mk.value, status.value, cmd.watchedOn);
  if (!st.ok) return st;
  const fields: Record<string, FieldValue> = {
    kind: mk.value, title: title.value, ...details.value, ...st.value, ...watchOrderFields(status.value, existing?.watchOrder ?? null, snap.maxWatchOrder), added_by: added.value, created_at: now,
  };
  if (cmd.tmdbId !== undefined && cmd.tmdbId !== null) {
    const t = need(parseTmdbId(cmd.tmdbId));
    if (!t.ok) return t;
    fields['tmdb_id'] = t.value;
  }
  // A removed row with this derived id is revived: a fresh insert under another id is impossible.
  if (existing) fields['deleted_at'] = null;
  return decided([{ tbl: 'titles', rowId: id.value, fields }]);
}

/** Status and watched_on of a personal status (D2): null takes the title off the list; never dropped. */
function memberStatusFields(kind: Kind, status: string | null, watchedOn: string | undefined): Result<Record<string, FieldValue>, Rejection> {
  if (status === null) return ok({ status: null, watched_on: null });
  const s = need(parseMemberStatus(status));
  if (!s.ok) return s;
  return statusFields(kind, s.value, watchedOn);
}

/** Insert carries the full key (title_id, member_id); later edits carry only what changes. */
function memberStatusChange(
  snap: Snapshot, t: { titleId: string; memberId: string; msId: string }, edit: Record<string, FieldValue>, now: Instant,
): Change {
  const ms = snap.memberStatus ?? null;
  const fields: Record<string, FieldValue> = ms ? (ms.deletedAt === null ? {} : { deleted_at: null }) : { title_id: t.titleId, member_id: t.memberId };
  return { tbl: 'member_status', rowId: ms?.id ?? t.msId, fields: { ...fields, ...edit, updated_at: now } };
}

/** D3: add to my own list. The title is created (or revived) without a Together status; an existing live one is left alone. */
function addJustMe(snap: Snapshot, cmd: Extract<Command, { kind: 'AddTitle' }>, titleId: string, addedBy: string, mediaKind: Kind, now: Instant): Decided {
  if (snap.deviceMemberId == null || snap.deviceMemberId !== addedBy) return err({ kind: 'NotYourList' });
  const msid = need(parseMemberStatusId(cmd.memberStatusId ?? ''));
  if (!msid.ok) return msid;
  const existing = snap.title ?? null;
  if (existing && existing.deletedAt === null && existing.mergedInto !== null) return err({ kind: 'AlreadyExists', id: existing.mergedInto });
  const ms = snap.memberStatus ?? null;
  if (existing && existing.deletedAt === null && ms && ms.deletedAt === null && ms.status !== null) return err({ kind: 'AlreadyExists', id: existing.id });
  const st = memberStatusFields(existing?.kind ?? mediaKind, cmd.status ?? 'later', cmd.watchedOn);
  if (!st.ok) return st;
  const changes: Change[] = [];
  if (!existing || existing.deletedAt !== null) {
    const title = need(parseTitle(cmd.title), titleRejection);
    if (!title.ok) return title;
    const details = detailFields(cmd);
    if (!details.ok) return details;
    const fields: Record<string, FieldValue> = { kind: mediaKind, title: title.value, ...details.value, status: null, added_by: addedBy, created_at: now };
    if (cmd.tmdbId !== undefined && cmd.tmdbId !== null) {
      const t = need(parseTmdbId(cmd.tmdbId));
      if (!t.ok) return t;
      fields['tmdb_id'] = t.value;
    }
    if (existing) fields['deleted_at'] = null;
    changes.push({ tbl: 'titles', rowId: titleId, fields });
  }
  changes.push(memberStatusChange(snap, { titleId, memberId: addedBy, msId: msid.value }, st.value, now));
  return decided(changes);
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
  return decided([{ tbl: 'titles', rowId: id.value, fields: { ...f.value, ...watchOrderFields(status.value, t.watchOrder, snap.maxWatchOrder) } }]);
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

function setStars(snap: Snapshot, cmd: Extract<Command, { kind: 'SetStars' }>, now: Instant): Decided {
  const t = ownRatingTarget(snap, cmd);
  if (!t.ok) return t;
  let stars: number | null = null;
  if (cmd.stars !== null) {
    const v = need(parseStars(cmd.stars));
    if (!v.ok) return v;
    stars = v.value;
  }
  return ratingChange(snap, t.value, { stars }, now);
}

function setReview(snap: Snapshot, cmd: Extract<Command, { kind: 'SetReview' }>, now: Instant): Decided {
  const t = ownRatingTarget(snap, cmd);
  if (!t.ok) return t;
  const review = need(parseReview(cmd.review), () => ({ kind: 'TooLong', field: 'review', max: REVIEW_MAX }));
  if (!review.ok) return review;
  return ratingChange(snap, t.value, { review: review.value }, now);
}

/** The own-list target: ids parsed, the device acts as `memberId`, the member and the title are live. */
function ownListTarget(snap: Snapshot, cmd: { titleId: string; memberId: string; memberStatusId: string }): Result<{ titleId: string; memberId: string; msId: string; title: TitleRow }, Rejection> {
  const tid = need(parseTitleId(cmd.titleId));
  if (!tid.ok) return tid;
  const mid = need(parseMemberId(cmd.memberId));
  if (!mid.ok) return mid;
  const sid = need(parseMemberStatusId(cmd.memberStatusId));
  if (!sid.ok) return sid;
  if (snap.deviceMemberId == null || snap.deviceMemberId !== mid.value) return err({ kind: 'NotYourList' });
  if (!snap.member || snap.member.id !== mid.value || snap.member.deletedAt !== null) return err({ kind: 'UnknownMember' });
  const title = liveTitle(snap.title);
  if (!title) return err({ kind: 'NotFound' });
  return ok({ titleId: tid.value, memberId: mid.value, msId: sid.value, title });
}

function setMyStatus(snap: Snapshot, cmd: Extract<Command, { kind: 'SetMyStatus' }>, now: Instant): Decided {
  const t = ownListTarget(snap, cmd);
  if (!t.ok) return t;
  const f = memberStatusFields(t.value.title.kind, cmd.status, cmd.watchedOn);
  if (!f.ok) return f;
  return decided([memberStatusChange(snap, t.value, f.value, now)]);
}

function setMySeason(snap: Snapshot, cmd: Extract<Command, { kind: 'SetMySeason' }>, now: Instant): Decided {
  const t = ownListTarget(snap, cmd);
  if (!t.ok) return t;
  const title = t.value.title;
  if (title.kind !== 'series') return err({ kind: 'NotASeries' });
  const season = need(parseSeason(cmd.season), () => ({ kind: 'SeasonOutOfRange', max: title.seasonCount }));
  if (!season.ok) return season;
  if (title.seasonCount !== null && season.value > title.seasonCount) return err({ kind: 'SeasonOutOfRange', max: title.seasonCount });
  return decided([memberStatusChange(snap, t.value, { current_season: season.value }, now)]);
}

function recommend(snap: Snapshot, cmd: Extract<Command, { kind: 'Recommend' }>, now: Instant): Decided {
  const tid = need(parseTitleId(cmd.titleId));
  if (!tid.ok) return tid;
  const from = need(parseMemberId(cmd.fromMember));
  if (!from.ok) return from;
  const to = need(parseMemberId(cmd.toMember));
  if (!to.ok) return to;
  const rid = need(parseRecommendationId(cmd.recommendationId));
  if (!rid.ok) return rid;
  if (snap.deviceMemberId == null || snap.deviceMemberId !== from.value) return err({ kind: 'NotYours' });
  if (from.value === to.value) return err(bad('toMember', 'cannot recommend to yourself'));
  if (!snap.member || snap.member.id !== to.value || snap.member.deletedAt !== null) return err({ kind: 'UnknownMember' });
  if (!liveTitle(snap.title)) return err({ kind: 'NotFound' });
  const existing = snap.recommendation ?? null;
  if (!existing) {
    return decided([{ tbl: 'recommendations', rowId: rid.value, fields: { title_id: tid.value, from_member: from.value, to_member: to.value, created_at: now } }]);
  }
  // Open or answered: nothing to send again. A withdrawn one is re-sent by clearing `withdrawn_at`, a field only the
  // recommender writes (the recipient's `answered` is never touched by the sender).
  if (existing.withdrawnAt === null && existing.deletedAt === null) return err({ kind: 'AlreadyExists', id: existing.id });
  if (existing.answered !== null) return err({ kind: 'AlreadyExists', id: existing.id });
  const fields: Record<string, FieldValue> = { withdrawn_at: null, created_at: now };
  if (existing.deletedAt !== null) fields['deleted_at'] = null;
  return decided([{ tbl: 'recommendations', rowId: existing.id, fields }]);
}

function withdrawRecommendation(snap: Snapshot, cmd: Extract<Command, { kind: 'WithdrawRecommendation' }>, now: Instant): Decided {
  const id = need(parseRecommendationId(cmd.id));
  if (!id.ok) return id;
  const r = snap.recommendation ?? null;
  if (!r || r.deletedAt !== null) return err({ kind: 'NotFound' });
  if (snap.deviceMemberId == null || snap.deviceMemberId !== r.fromMember) return err({ kind: 'NotYours' });
  if (r.withdrawnAt !== null || r.answered !== null) return decided([]);
  return decided([{ tbl: 'recommendations', rowId: r.id, fields: { withdrawn_at: now } }]);
}

function answerRecommendation(snap: Snapshot, cmd: Extract<Command, { kind: 'AnswerRecommendation' }>, now: Instant): Decided {
  const id = need(parseRecommendationId(cmd.id));
  if (!id.ok) return id;
  const tid = need(parseTitleId(cmd.titleId));
  if (!tid.ok) return tid;
  const mid = need(parseMemberId(cmd.memberId));
  if (!mid.ok) return mid;
  const sid = need(parseMemberStatusId(cmd.memberStatusId));
  if (!sid.ok) return sid;
  const answer = need(parseAnswer(cmd.answer));
  if (!answer.ok) return answer;
  if (snap.deviceMemberId == null || snap.deviceMemberId !== mid.value) return err({ kind: 'NotYours' });
  const r = snap.recommendation ?? null;
  if (!r || r.deletedAt !== null) return err({ kind: 'NotFound' });
  if (r.toMember !== mid.value) return err({ kind: 'NotYours' });
  if (r.titleId !== tid.value) return err(bad('titleId', 'not the title of this recommendation'));
  if (r.answered !== null) return decided([]);
  if (r.withdrawnAt !== null) return err({ kind: 'NotFound' });
  const changes: Change[] = [{ tbl: 'recommendations', rowId: r.id, fields: { answered: answer.value, answered_at: now } }];
  if (answer.value === 'accepted') {
    if (!liveTitle(snap.title)) return err({ kind: 'NotFound' });
    const ms = snap.memberStatus ?? null;
    if (!ms || ms.deletedAt !== null || ms.status === null) {
      changes.push(memberStatusChange(snap, { titleId: tid.value, memberId: mid.value, msId: sid.value }, { status: 'later', watched_on: null }, now));
    }
  }
  return decided(changes);
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
    case 'SetStars':
      return setStars(snapshot, cmd, now);
    case 'SetReview':
      return setReview(snapshot, cmd, now);
    case 'SetMyStatus':
      return setMyStatus(snapshot, cmd, now);
    case 'SetMySeason':
      return setMySeason(snapshot, cmd, now);
    case 'Recommend':
      return recommend(snapshot, cmd, now);
    case 'WithdrawRecommendation':
      return withdrawRecommendation(snapshot, cmd, now);
    case 'AnswerRecommendation':
      return answerRecommendation(snapshot, cmd, now);
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
