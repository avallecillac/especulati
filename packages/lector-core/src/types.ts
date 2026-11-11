import { err, ok, UUID_PATTERN, type Brand, type ParseError, type Result } from '@especulati/sync-core';

export type ItemId = Brand<string, 'ItemId'>;
export type EventId = Brand<string, 'EventId'>;
export type NonEmptyTitle = Brand<string, 'NonEmptyTitle'>;
export type Author = Brand<string, 'Author'>;
export type Isbn13 = Brand<string, 'Isbn13'>;
export type CoverUrl = Brand<string, 'CoverUrl'>;
export type Genre = Brand<string, 'Genre'>;
export type PageCount = Brand<number, 'PageCount'>;
export type Page = Brand<number, 'Page'>;
/** Calendar day as experienced by the user, YYYY-MM-DD. Never derived from UTC. */
export type LocalDate = Brand<string, 'LocalDate'>;
/** UTC ISO-8601 with Z. */
export type Instant = Brand<string, 'Instant'>;

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

const ISBN10_RE = /^\d{9}[\dX]$/;
const ISBN13_RE = /^97[89]\d{10}$/;

/** Mod-10 (EAN-13) check digit for the first 12 digits. */
function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** ISBN-10 or ISBN-13 (hyphens/spaces, lowercase x allowed) → normalized ISBN-13 (research R6). */
export function parseIsbn(input: string): Result<Isbn13, ParseError> {
  const s = input.replace(/[\s-]/g, '').toUpperCase();
  if (s.length === 10 && ISBN10_RE.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    if (sum % 11 !== 0) return fail('isbn', 'bad check digit');
    const first12 = `978${s.slice(0, 9)}`;
    return ok(`${first12}${isbn13CheckDigit(first12)}` as Isbn13);
  }
  if (s.length === 13 && ISBN13_RE.test(s)) {
    return isbn13CheckDigit(s.slice(0, 12)) === Number(s[12]) ? ok(s as Isbn13) : fail('isbn', 'bad check digit');
  }
  return fail('isbn', 'not an ISBN-10 or ISBN-13');
}

/** "https://…, at most 500 characters" */
export function parseCoverUrl(input: string): Result<CoverUrl, ParseError> {
  if (!input.startsWith('https://')) return fail('coverUrl', 'must start with https://');
  if (input.length > 500) return fail('coverUrl', 'longer than 500 characters');
  return ok(input as CoverUrl);
}
