import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, MEMBER_STATUS_LABEL_PREFIX, RATING_LABEL_PREFIX, RECOMMENDATION_LABEL_PREFIX, TITLE_LABEL_PREFIX } from '../src/frozen.ts';
import { manualTitleLabel, memberStatusLabel, ratingLabel, recommendationLabel, tmdbTitleLabel } from '../src/index.ts';

// Changing any of these re-derives every id and splits the catalog. See CLAUDE.md "Frozen identifiers".
describe('frozen identifiers', () => {
  it('pins the values', () => {
    expect(TITLE_LABEL_PREFIX).toBe('cinefilo-title-v1');
    expect(RATING_LABEL_PREFIX).toBe('cinefilo-rating-v1');
    expect(EXPORT_FORMAT).toBe('cinefilo/v1');
    expect(MEMBER_STATUS_LABEL_PREFIX).toBe('cinefilo-mstatus-v1');
    expect(RECOMMENDATION_LABEL_PREFIX).toBe('cinefilo-rec-v1');
  });
  it('label builders start with the pinned prefixes', () => {
    expect(tmdbTitleLabel('movie', 1).startsWith('cinefilo-title-v1|tmdb|')).toBe(true);
    expect(manualTitleLabel('movie', 'x', null).startsWith('cinefilo-title-v1|manual|')).toBe(true);
    expect(ratingLabel('a', 'b').startsWith('cinefilo-rating-v1|')).toBe(true);
    expect(memberStatusLabel('t', 'm')).toBe('cinefilo-mstatus-v1|t|m');
    expect(recommendationLabel('t', 'f', 'o')).toBe('cinefilo-rec-v1|t|f|o');
  });
});
