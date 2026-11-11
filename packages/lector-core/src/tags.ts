import { err, ok, type ParseError, type Result } from '@especulati/sync-core';

/** Tag names: 1 to 40 characters (code points). */
export const TAG_NAME_MAX = 40;
/** At most this many live tags on one article (008 T-1). */
export const TAGS_PER_ARTICLE_MAX = 20;

const codePoints = (s: string): number => [...s].length;

/**
 * Research R3: `nfkc(name).trim().replace(/\s+/g, ' ').toLowerCase()`. Two names are the same tag
 * when their keys are equal. Null when the name is empty after normalising.
 */
export function tagKey(name: string): string | null {
  const key = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return key === '' ? null : key;
}

/**
 * The shown name: trimmed, 1 to 40 characters. Also rejects a name whose key would be over 40
 * characters (NFKC can expand "ﬃ" to "ffi"), because the DB checks both columns' length.
 */
export function tagName(name: string): Result<string, ParseError> {
  const trimmed = name.trim();
  const key = tagKey(trimmed);
  if (trimmed === '' || key === null) return err({ field: 'name', reason: 'required' });
  if (codePoints(trimmed) > TAG_NAME_MAX || codePoints(key) > TAG_NAME_MAX) {
    return err({ field: 'name', reason: `must be at most ${TAG_NAME_MAX} characters` });
  }
  return ok(trimmed);
}
