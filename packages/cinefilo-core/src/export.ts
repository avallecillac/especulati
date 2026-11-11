import { err, ok, type ParseError, type Result } from '@especulati/sync-core';
import { EXPORT_FORMAT } from './frozen.ts';
import type { MemberRow, RatingRow, TitleRow } from './rows.ts';
import {
  fail, parseInstant, parseKind, parseLocalDate, parseMemberId, parseMemberName, parseRatingId, parseReview, parseStatus, parseTitle,
  parseTitleId, parseVerdict, type Instant,
} from './types.ts';

/**
 * The `cinefilo/v1` file (D10): titles (with `merged_into` and `deleted_at`), members and ratings.
 * Never `meta`, posters or the TMDB key: only the keys below are ever written.
 */
export interface CinefiloExport {
  readonly format: typeof EXPORT_FORMAT;
  readonly exportedAt: Instant;
  readonly titles: readonly TitleRow[];
  readonly members: readonly MemberRow[];
  readonly ratings: readonly RatingRow[];
}

const byId = <T extends { id: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Deterministic JSON: rows sorted by id, keys in a fixed order, nothing but the known fields. */
export function serializeExport(e: CinefiloExport): string {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    exportedAt: e.exportedAt,
    titles: byId(e.titles).map((t) => ({
      id: t.id, kind: t.kind, title: t.title, originalTitle: t.originalTitle, year: t.year, tmdbId: t.tmdbId, posterUrl: t.posterUrl,
      genres: t.genres, runtimeMin: t.runtimeMin, seasonCount: t.seasonCount, status: t.status, watchedOn: t.watchedOn,
      currentSeason: t.currentSeason, mergedInto: t.mergedInto, addedBy: t.addedBy, createdAt: t.createdAt, deletedAt: t.deletedAt,
    })),
    members: byId(e.members).map((m) => ({ id: m.id, name: m.name, createdAt: m.createdAt, deletedAt: m.deletedAt })),
    ratings: byId(e.ratings).map((r) => ({
      id: r.id, titleId: r.titleId, memberId: r.memberId, verdict: r.verdict, review: r.review, updatedAt: r.updatedAt, deletedAt: r.deletedAt,
    })),
  });
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (field: string, v: unknown): Result<string, ParseError> => (typeof v === 'string' ? ok(v) : fail(field, 'must be a string'));
const nullable = <T>(field: string, v: unknown, f: (s: string) => Result<T, ParseError>): Result<T | null, ParseError> =>
  v === null ? ok(null) : typeof v === 'string' ? f(v) : fail(field, 'must be a string or null');
const plainText = (_field: string) => (s: string): Result<string, ParseError> => ok(s);
const intOrNull = (field: string, v: unknown): Result<number | null, ParseError> =>
  v === null ? ok(null) : typeof v === 'number' && Number.isInteger(v) ? ok(v) : fail(field, 'must be a whole number or null');

/** Run field parsers in order and stop at the first failure. */
function collect<T>(build: (take: <V>(r: Result<V, ParseError>) => V) => T): Result<T, ParseError> {
  class Stop extends Error {}
  const stop = new Stop();
  let failure: ParseError | null = null;
  const take = <V>(r: Result<V, ParseError>): V => {
    if (r.ok) return r.value;
    failure = r.error;
    throw stop;
  };
  try {
    return ok(build(take));
  } catch (e) {
    if (e === stop && failure) return err(failure);
    throw e;
  }
}

const parseTitleRow = (o: unknown): Result<TitleRow, ParseError> => {
  if (!isObj(o)) return fail('titles', 'row must be an object');
  return collect((take) => {
    const genres = o['genres'];
    if (genres !== null && !(Array.isArray(genres) && genres.every((g) => typeof g === 'string'))) take(fail('genres', 'must be a list of strings or null'));
    const row: TitleRow = {
      id: take(parseTitleId(take(str('id', o['id'])))),
      kind: take(parseKind(take(str('kind', o['kind'])))),
      title: take(parseTitle(take(str('title', o['title'])))),
      originalTitle: take(nullable('originalTitle', o['originalTitle'], plainText('originalTitle'))),
      year: take(intOrNull('year', o['year'])),
      tmdbId: take(intOrNull('tmdbId', o['tmdbId'])),
      posterUrl: take(nullable('posterUrl', o['posterUrl'], plainText('posterUrl'))),
      genres: genres as readonly string[] | null,
      runtimeMin: take(intOrNull('runtimeMin', o['runtimeMin'])),
      seasonCount: take(intOrNull('seasonCount', o['seasonCount'])),
      status: take(parseStatus(take(str('status', o['status'])))),
      watchedOn: take(nullable('watchedOn', o['watchedOn'], parseLocalDate)),
      currentSeason: take(intOrNull('currentSeason', o['currentSeason'])),
      mergedInto: take(nullable('mergedInto', o['mergedInto'], parseTitleId)),
      addedBy: take(parseMemberId(take(str('addedBy', o['addedBy'])))),
      createdAt: take(parseInstant(take(str('createdAt', o['createdAt'])))),
      deletedAt: take(nullable('deletedAt', o['deletedAt'], parseInstant)),
    };
    return row;
  });
};

const parseMemberRow = (o: unknown): Result<MemberRow, ParseError> => {
  if (!isObj(o)) return fail('members', 'row must be an object');
  return collect((take) => ({
    id: take(parseMemberId(take(str('id', o['id'])))),
    name: take(parseMemberName(take(str('name', o['name'])))),
    createdAt: take(parseInstant(take(str('createdAt', o['createdAt'])))),
    deletedAt: take(nullable('deletedAt', o['deletedAt'], parseInstant)),
  }));
};

const parseRatingRow = (o: unknown): Result<RatingRow, ParseError> => {
  if (!isObj(o)) return fail('ratings', 'row must be an object');
  return collect((take) => ({
    id: take(parseRatingId(take(str('id', o['id'])))),
    titleId: take(parseTitleId(take(str('titleId', o['titleId'])))),
    memberId: take(parseMemberId(take(str('memberId', o['memberId'])))),
    verdict: take(nullable('verdict', o['verdict'], parseVerdict)),
    review: take(nullable('review', o['review'], (s) => parseReview(s))),
    updatedAt: take(parseInstant(take(str('updatedAt', o['updatedAt'])))),
    deletedAt: take(nullable('deletedAt', o['deletedAt'], parseInstant)),
  }));
};

function parseRows<T>(field: string, v: unknown, one: (o: unknown) => Result<T, ParseError>): Result<T[], ParseError> {
  if (!Array.isArray(v)) return fail(field, 'must be a list');
  const out: T[] = [];
  for (const o of v) {
    const r = one(o);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}

/** Parse and fully validate a file's text; any problem rejects the whole file (an import applies completely or not at all). */
export function parseExport(text: string): Result<CinefiloExport, ParseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('file', 'not JSON');
  }
  if (!isObj(raw)) return fail('file', 'not an object');
  if (raw['format'] !== EXPORT_FORMAT) return fail('format', 'unsupported version');
  return collect((take) => ({
    format: EXPORT_FORMAT,
    exportedAt: take(parseInstant(take(str('exportedAt', raw['exportedAt'])))),
    titles: take(parseRows('titles', raw['titles'], parseTitleRow)),
    members: take(parseRows('members', raw['members'], parseMemberRow)),
    ratings: take(parseRows('ratings', raw['ratings'], parseRatingRow)),
  }));
}
