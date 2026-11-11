import { err, ok, UUID_PATTERN, type Brand, type ParseError, type Result } from '@especulati/sync-core';

export type TitleId = Brand<string, 'TitleId'>;
export type MemberId = Brand<string, 'MemberId'>;
export type RatingId = Brand<string, 'RatingId'>;
export type NonEmptyTitle = Brand<string, 'NonEmptyTitle'>;
export type MemberName = Brand<string, 'MemberName'>;
export type Review = Brand<string, 'Review'>;
export type Season = Brand<number, 'Season'>;
/** Calendar day as experienced by the user, YYYY-MM-DD. Never derived from UTC. */
export type LocalDate = Brand<string, 'LocalDate'>;
/** UTC ISO-8601 with Z. */
export type Instant = Brand<string, 'Instant'>;

export type Kind = 'movie' | 'series';
export type Status = 'later' | 'watching' | 'watched' | 'dropped';
export type Verdict = 'like' | 'meh' | 'dislike';

export const KINDS: readonly Kind[] = ['movie', 'series'];
export const STATUSES: readonly Status[] = ['later', 'watching', 'watched', 'dropped'];
export const VERDICTS: readonly Verdict[] = ['like', 'meh', 'dislike'];

export const TITLE_MAX = 500;
export const MEMBER_NAME_MAX = 50;
export const REVIEW_MAX = 1000;
export const SEASON_MAX = 1000;

const UUID_RE = new RegExp(`^${UUID_PATTERN}$`);
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export const fail = (field: string, reason: string) => err<ParseError>({ field, reason });
const codePoints = (s: string): number => [...s].length;

function parseUuid<T>(field: string, input: string): Result<T, ParseError> {
  return typeof input === 'string' && UUID_RE.test(input) ? ok(input as T) : fail(field, 'not a lowercase uuid');
}
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

export const parseTitleId = (s: string) => parseUuid<TitleId>('titleId', s);
export const parseMemberId = (s: string) => parseUuid<MemberId>('memberId', s);
export const parseRatingId = (s: string) => parseUuid<RatingId>('ratingId', s);

function parseEnum<T extends string>(field: string, all: readonly T[], s: string): Result<T, ParseError> {
  return (all as readonly string[]).includes(s) ? ok(s as T) : fail(field, `must be one of ${all.join(', ')}`);
}
export const parseKind = (s: string) => parseEnum('kind', KINDS, s);
export const parseStatus = (s: string) => parseEnum('status', STATUSES, s);
export const parseVerdict = (s: string) => parseEnum('verdict', VERDICTS, s);

/** "Trimmed, 1–500 characters" */
export function parseTitle(input: string): Result<NonEmptyTitle, ParseError> {
  const t = input.trim();
  if (t.length === 0) return fail('title', 'required');
  if (codePoints(t) > TITLE_MAX) return fail('title', `longer than ${TITLE_MAX} characters`);
  return ok(t as NonEmptyTitle);
}

/** "Trimmed, 1–50 characters" */
export function parseMemberName(input: string): Result<MemberName, ParseError> {
  const t = input.trim();
  if (t.length === 0) return fail('name', 'required');
  if (codePoints(t) > MEMBER_NAME_MAX) return fail('name', `longer than ${MEMBER_NAME_MAX} characters`);
  return ok(t as MemberName);
}

/** "Trimmed, at most 1,000 characters; empty → null" (counted in code points, like SQLite's length()) */
export function parseReview(input: string | null | undefined): Result<Review | null, ParseError> {
  const t = (input ?? '').trim();
  if (t.length === 0) return ok(null);
  if (codePoints(t) > REVIEW_MAX) return fail('review', `longer than ${REVIEW_MAX} characters`);
  return ok(t as Review);
}

/** "Whole number, 1–1000" (the upper bound against a known season count needs the title) */
export function parseSeason(n: number): Result<Season, ParseError> {
  return Number.isInteger(n) && n >= 1 && n <= SEASON_MAX ? ok(n as Season) : fail('season', `must be a whole number from 1 to ${SEASON_MAX}`);
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** "YYYY-MM-DD, a real calendar date" */
export function parseLocalDate(input: string): Result<LocalDate, ParseError> {
  const m = LOCAL_DATE_RE.exec(input);
  if (!m) return fail('localDate', 'not YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12) return fail('localDate', 'no such month');
  const max = mo === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[mo - 1]!;
  if (d < 1 || d > max) return fail('localDate', 'no such day');
  return ok(input as LocalDate);
}

/** "UTC ISO-8601 with Z" */
export function parseInstant(input: string): Result<Instant, ParseError> {
  return INSTANT_RE.test(input) ? ok(input as Instant) : fail('instant', 'not UTC ISO-8601');
}
