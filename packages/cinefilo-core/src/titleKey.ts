import { MEMBER_STATUS_LABEL_PREFIX, RATING_LABEL_PREFIX, RECOMMENDATION_LABEL_PREFIX, TITLE_LABEL_PREFIX } from './frozen.ts';
import type { Kind } from './types.ts';

/**
 * Normalization behind a manual title's id: NFKD, strip combining marks, lowercase, turn runs of
 * whitespace and punctuation into one space, trim. Core owns this; the shell hashes the label.
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

/** Label the shell hashes (`uuidFromHash`) into the id of a title added from TMDB. */
export const tmdbTitleLabel = (kind: Kind, tmdbId: number): string => `${TITLE_LABEL_PREFIX}|tmdb|${kind}|${tmdbId}`;

/** Label for a title added by hand: the same normalized title, kind and year give the same id. */
export const manualTitleLabel = (kind: Kind, title: string, year: number | null): string =>
  `${TITLE_LABEL_PREFIX}|manual|${kind}|${titleKey(title)}|${year ?? ''}`;

/** Label for the rating of `memberId` on `titleId`. */
export const ratingLabel = (titleId: string, memberId: string): string => `${RATING_LABEL_PREFIX}|${titleId}|${memberId}`;

/** Label for the personal status of `memberId` on `titleId` (D1). */
export const memberStatusLabel = (titleId: string, memberId: string): string => `${MEMBER_STATUS_LABEL_PREFIX}|${titleId}|${memberId}`;

/** Label for the recommendation of `titleId` from one member to another (D1). */
export const recommendationLabel = (titleId: string, fromMember: string, toMember: string): string =>
  `${RECOMMENDATION_LABEL_PREFIX}|${titleId}|${fromMember}|${toMember}`;
