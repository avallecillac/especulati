import { describe, expect, it } from 'vitest';
import {
  parseInstant, parseKind, parseLocalDate, parseMemberId, parseMemberName, parseRatingId, parseReview, parseSeason, parseStatus,
  parseTitle, parseTitleId, parseVerdict,
} from '../src/index.ts';

const U = '0000000a-0000-4000-8000-00000000000b';

describe('ids', () => {
  it('accepts lowercase uuids for title, member and rating ids', () => {
    for (const p of [parseTitleId, parseMemberId, parseRatingId]) expect(p(U)).toEqual({ ok: true, value: U });
  });
  it('rejects anything else', () => {
    for (const p of [parseTitleId, parseMemberId, parseRatingId]) {
      expect(p(U.toUpperCase()).ok).toBe(false);
      expect(p('').ok).toBe(false);
      expect(p('nope').ok).toBe(false);
    }
  });
});

describe('enums', () => {
  it('Kind', () => {
    expect(parseKind('movie').ok && parseKind('series').ok).toBe(true);
    expect(parseKind('show').ok).toBe(false);
  });
  it('Status', () => {
    for (const s of ['later', 'watching', 'watched', 'dropped']) expect(parseStatus(s).ok).toBe(true);
    expect(parseStatus('done').ok).toBe(false);
  });
  it('Verdict', () => {
    for (const s of ['like', 'meh', 'dislike']) expect(parseVerdict(s).ok).toBe(true);
    expect(parseVerdict('love').ok).toBe(false);
    expect(parseVerdict('').ok).toBe(false);
  });
});

describe('LocalDate', () => {
  it('accepts real calendar days', () => {
    expect(parseLocalDate('2026-02-28').ok).toBe(true);
    expect(parseLocalDate('2024-02-29').ok).toBe(true);
  });
  it('rejects malformed and impossible days', () => {
    for (const s of ['2026-2-28', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '20260228', '']) {
      expect(parseLocalDate(s).ok, s).toBe(false);
    }
  });
});

describe('Instant', () => {
  it('requires UTC ISO-8601 with Z', () => {
    expect(parseInstant('2026-09-27T12:00:00.000Z').ok).toBe(true);
    expect(parseInstant('2026-09-27T12:00:00Z').ok).toBe(true);
    expect(parseInstant('2026-09-27T12:00:00+02:00').ok).toBe(false);
  });
});

describe('NonEmptyTitle', () => {
  it('trims', () => {
    expect(parseTitle('  Stalker ')).toEqual({ ok: true, value: 'Stalker' });
  });
  it('rejects empty and whitespace-only as required', () => {
    for (const s of ['', '   ', '\n\t']) {
      const r = parseTitle(s);
      expect(r).toEqual({ ok: false, error: { field: 'title', reason: 'required' } });
    }
  });
  it('allows 500 characters and rejects 501', () => {
    expect(parseTitle('a'.repeat(500)).ok).toBe(true);
    expect(parseTitle('a'.repeat(501)).ok).toBe(false);
  });
});

describe('MemberName', () => {
  it('trims, is required, and is at most 50 characters', () => {
    expect(parseMemberName(' Lu ')).toEqual({ ok: true, value: 'Lu' });
    expect(parseMemberName('  ').ok).toBe(false);
    expect(parseMemberName('a'.repeat(50)).ok).toBe(true);
    expect(parseMemberName('a'.repeat(51)).ok).toBe(false);
  });
});

describe('Review', () => {
  it('trims', () => {
    expect(parseReview('  great  ')).toEqual({ ok: true, value: 'great' });
  });
  it('maps empty, whitespace-only, null and undefined to null', () => {
    for (const s of ['', '   ', null, undefined]) expect(parseReview(s)).toEqual({ ok: true, value: null });
  });
  it('allows exactly 1,000 characters and rejects 1,001', () => {
    expect(parseReview('a'.repeat(1000)).ok).toBe(true);
    expect(parseReview('a'.repeat(1001)).ok).toBe(false);
  });
  it('counts characters after trimming', () => {
    expect(parseReview(` ${'a'.repeat(1000)} `).ok).toBe(true);
  });
  it('counts code points, not UTF-16 units', () => {
    expect(parseReview('🎬'.repeat(1000)).ok).toBe(true);
    expect(parseReview('🎬'.repeat(1001)).ok).toBe(false);
  });
});

describe('Season', () => {
  it('accepts whole numbers from 1', () => {
    expect(parseSeason(1).ok && parseSeason(12).ok).toBe(true);
  });
  it('rejects 0, negatives, fractions, NaN', () => {
    for (const n of [0, -1, 1.5, NaN, Infinity]) expect(parseSeason(n).ok, String(n)).toBe(false);
  });
});
