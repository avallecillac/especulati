import { err, ok, type Result } from './result.ts';
import type { DetailsStatus } from './book.ts';
import type { NormalizedUrl } from './url.ts';
import type { Author, Brand, Instant, ItemId, LocalDate, NonEmptyTitle, ParseError } from './types.ts';

/** An integer in 0..100000 (data-model). */
export type WordCount = Brand<number, 'WordCount'>;

const MAX_WORDS = 100_000;
/** Average adult reading speed (research R10). */
const WORDS_PER_MINUTE = 238;

export function parseWordCount(n: number): Result<WordCount, ParseError> {
  return Number.isInteger(n) && n >= 0 && n <= MAX_WORDS
    ? ok(n as WordCount)
    : err({ field: 'wordCount', reason: 'must be a whole number from 0 to 100000' });
}

/** An article (an `items` row with type 'article'). It has no reading events. */
export interface Article {
  readonly id: ItemId;
  readonly title: NonEmptyTitle;
  readonly author: Author | null;
  readonly url: NormalizedUrl;
  readonly domain: string;
  readonly wordCount: WordCount | null;
  readonly readOn: LocalDate;
  /** `notFound` means "details not fetched" (a manual add). */
  readonly detailsStatus: DetailsStatus;
  readonly createdAt: Instant;
  readonly deletedAt: Instant | null;
}

/** ceil(words / 238); null when the count is unknown. */
export const readingMinutes = (words: number | null): number | null => (words === null ? null : Math.ceil(words / WORDS_PER_MINUTE));
