import { err, ok, type Result } from './result.ts';

declare const brand: unique symbol;
/** Nominal typing: a value of Brand<T, B> can only be produced by B's parser. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ItemId = Brand<string, 'ItemId'>;
export type EventId = Brand<string, 'EventId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type NonEmptyTitle = Brand<string, 'NonEmptyTitle'>;
export type Author = Brand<string, 'Author'>;
export type Genre = Brand<string, 'Genre'>;
export type PageCount = Brand<number, 'PageCount'>;
export type Page = Brand<number, 'Page'>;
/** Calendar day as experienced by the user, YYYY-MM-DD. Never derived from UTC. */
export type LocalDate = Brand<string, 'LocalDate'>;
/** UTC ISO-8601 with Z. */
export type Instant = Brand<string, 'Instant'>;

export interface ParseError {
  readonly field: string;
  readonly reason: string;
}

export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`);
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const MAX_PAGES = 100_000;

const fail = (field: string, reason: string) => err<ParseError>({ field, reason });

function parseUuid<T>(field: string, input: string): Result<T, ParseError> {
  return UUID_RE.test(input) ? ok(input as T) : fail(field, 'not a lowercase uuid');
}

export const parseItemId = (s: string) => parseUuid<ItemId>('itemId', s);
export const parseEventId = (s: string) => parseUuid<EventId>('eventId', s);
export const parseDeviceId = (s: string) => parseUuid<DeviceId>('deviceId', s);

/** "Trimmed, 1–500 characters" */
export function parseTitle(input: string): Result<NonEmptyTitle, ParseError> {
  const t = input.trim();
  if (t.length === 0) return fail('title', 'required');
  if (t.length > 500) return fail('title', 'longer than 500 characters');
  return ok(t as NonEmptyTitle);
}

function parseOptionalText<T>(field: string, input: string | null | undefined): Result<T | null, ParseError> {
  const t = (input ?? '').trim();
  if (t.length === 0) return ok(null);
  if (t.length > 200) return fail(field, 'longer than 200 characters');
  return ok(t as T);
}

/** "Trimmed, 1–200 characters; empty input → null" */
export const parseAuthor = (s: string | null | undefined) => parseOptionalText<Author>('author', s);
/** "Trimmed, 1–200 characters; empty input → null" */
export const parseGenre = (s: string | null | undefined) => parseOptionalText<Genre>('genre', s);

function parseBoundedInt<T>(field: string, n: number): Result<T, ParseError> {
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAGES ? ok(n as T) : fail(field, 'must be a whole number from 1 to 100000');
}

/** "Integer, 1–100 000" */
export const parsePageCount = (n: number) => parseBoundedInt<PageCount>('totalPages', n);
/** "Integer, 1–100 000" (the ≤ total_pages rule needs the book, so decide() checks it) */
export const parsePage = (n: number) => parseBoundedInt<Page>('page', n);

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

/** The calendar day before `d` — pure calendar arithmetic, immune to DST (research R6). */
export function previousLocalDate(d: LocalDate): LocalDate {
  let y = Number(d.slice(0, 4));
  let m = Number(d.slice(5, 7));
  let day = Number(d.slice(8, 10)) - 1;
  if (day === 0) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    day = m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m - 1]!;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` as LocalDate;
}
