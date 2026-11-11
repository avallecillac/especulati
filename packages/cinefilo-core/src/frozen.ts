/**
 * Frozen identifiers (CLAUDE.md "Frozen identifiers"): changing one re-derives every id or orphans
 * exported files. The shell hashes these labels; core only builds the strings. Pinned by
 * `test/frozen.test.ts`.
 */
export const TITLE_LABEL_PREFIX = 'cinefilo-title-v1';
export const RATING_LABEL_PREFIX = 'cinefilo-rating-v1';
export const EXPORT_FORMAT = 'cinefilo/v1';
