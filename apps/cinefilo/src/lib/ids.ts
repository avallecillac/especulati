// Derived ids (design D3). Core has no crypto, so the shell hashes the labels core builds: the same title,
// kind and year (or TMDB id) gives the same id on every device, so concurrent adds collapse into one row.

import { uuidFromHash } from '@especulati/sync';
import { manualTitleLabel, ratingLabel, tmdbTitleLabel, type Kind } from '@especulati/cinefilo-core';

/** SHA-256 of the label, first 16 bytes, v4/variant bits, as a lowercase UUID (WebCrypto; `@especulati/sync`'s shared hash). */
export { uuidFromHash };

export const titleIdFor = (kind: Kind, title: string, year: number | null, tmdbId: number | null | undefined): Promise<string> =>
  uuidFromHash(tmdbId != null ? tmdbTitleLabel(kind, tmdbId) : manualTitleLabel(kind, title, year));

export const ratingIdFor = (titleId: string, memberId: string): Promise<string> => uuidFromHash(ratingLabel(titleId, memberId));
