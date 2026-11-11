import { err, ok, UUID_PATTERN, type Brand, type Result } from '@especulati/sync-core';
import type { Instant, ItemId, LocalDate } from './types.ts';

export type HighlightId = Brand<string, 'HighlightId'>;

/** One highlight or note under an item (007 data-model). At least one of quote and note is set. */
export interface Highlight {
  readonly id: HighlightId;
  readonly itemId: ItemId;
  readonly quote: string | null;
  readonly note: string | null;
  /** Books only (FR-013); null on articles. */
  readonly page: number | null;
  readonly createdAt: Instant;
  readonly localDate: LocalDate;
  readonly deletedAt: Instant | null;
}

/** Characters (code points), never truncated. */
export const QUOTE_MAX = 5000;
export const NOTE_MAX = 5000;

export type TooLongError = { readonly kind: 'TooLong'; readonly max: 5000 };

const HIGHLIGHT_ID_RE = new RegExp(`^${UUID_PATTERN}$`);
export const isHighlightId = (s: string): s is HighlightId => HIGHLIGHT_ID_RE.test(s);

const codePoints = (s: string): number => [...s].length;

/** Steps shared by quotes and notes: LF newlines, then 3+ newlines become 2 (R3 steps 1, 3). */
const squashNewlines = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');

/**
 * Research R3. Quote: CRLF/CR to LF; spaces, tabs and NBSP collapse to one space per line and each
 * line is trimmed; 3+ newlines become 2; trimmed; empty gives null; over 5,000 code points is TooLong.
 */
export function normalizeQuote(s: string): Result<string | null, TooLongError> {
  const perLine = s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n');
  const q = squashNewlines(perLine).trim();
  if (q === '') return ok(null);
  return codePoints(q) > QUOTE_MAX ? err({ kind: 'TooLong', max: 5000 }) : ok(q);
}

/** A note keeps its internal spacing (R3: all steps but the per-line collapse). */
export function normalizeNote(s: string): Result<string | null, TooLongError> {
  const n = squashNewlines(s).trim();
  if (n === '') return ok(null);
  return codePoints(n) > NOTE_MAX ? err({ kind: 'TooLong', max: 5000 }) : ok(n);
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** encodeURIComponent, plus '-' (a text-directive range marker); ',' and '&' are already escaped. */
const encodeWords = (s: string): string => encodeURIComponent(s.replace(LONE_SURROGATE, '�')).replace(/-/g, '%2D');

/** Research R4: `#:~:text=` for up to 8 words, else first 4 words + ',' + last 4 words. Line breaks act as spaces. */
export function textFragment(quote: string): string {
  const words = quote.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return '';
  const text =
    words.length <= 8
      ? encodeWords(words.join(' '))
      : `${encodeWords(words.slice(0, 4).join(' '))},${encodeWords(words.slice(-4).join(' '))}`;
  return `#:~:text=${text}`;
}

/** The article URL plus a text fragment for `quote`; the URL unchanged when there is no quote. */
export function passageUrl(url: string, quote: string | null): string {
  return quote === null || quote === '' ? url : url + textFragment(quote);
}
