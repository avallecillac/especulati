import { describe, expect, it } from 'vitest';
import {
  parseAuthor, parseDeviceId, parseGenre, parseInstant, parseItemId, parseLocalDate,
  parsePage, parsePageCount, parseTitle, previousLocalDate, type Result,
} from '../src/index.ts';
import { parseHlc } from '../src/hlc.ts';

const ok = <T>(r: Result<T, unknown>): T | undefined => { expect(r.ok).toBe(true); return r.ok ? r.value : undefined; };
const bad = (r: { ok: boolean }) => expect(r.ok).toBe(false);

describe('NonEmptyTitle: "Trimmed, 1–500 characters"', () => {
  it('trims and accepts', () => expect(ok(parseTitle('  Dune  '))).toBe('Dune'));
  it('accepts exactly 500', () => expect(ok(parseTitle('x'.repeat(500)))).toHaveLength(500));
  it('rejects blank and whitespace-only', () => { bad(parseTitle('')); bad(parseTitle('   \n\t')); });
  it('rejects 501', () => bad(parseTitle('x'.repeat(501))));
});

describe('Author/Genre: "Trimmed, 1–200 characters; empty input → null"', () => {
  it('empty → null', () => {
    expect(ok(parseAuthor(''))).toBeNull();
    expect(ok(parseAuthor('   '))).toBeNull();
    expect(ok(parseGenre(null))).toBeNull();
    expect(ok(parseGenre(undefined))).toBeNull();
  });
  it('trims', () => expect(ok(parseAuthor(' Le Guin '))).toBe('Le Guin'));
  it('rejects 201', () => { bad(parseAuthor('a'.repeat(201))); bad(parseGenre('g'.repeat(201))); });
});

describe('PageCount and Page: "Integer, 1–100 000"', () => {
  for (const parse of [parsePageCount, parsePage] as ((n: number) => Result<number, unknown>)[]) {
    it(`${parse.name} accepts bounds`, () => { expect(ok(parse(1))).toBe(1); expect(ok(parse(100_000))).toBe(100_000); });
    it(`${parse.name} rejects 0, negatives, fractions, NaN, too large`, () => {
      for (const v of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 100_001]) bad(parse(v));
    });
  }
});

describe('LocalDate: "YYYY-MM-DD, a real calendar date"', () => {
  it('accepts real dates incl. leap day', () => {
    expect(ok(parseLocalDate('2026-09-27'))).toBe('2026-09-27');
    ok(parseLocalDate('2024-02-29'));
    ok(parseLocalDate('2000-02-29'));
  });
  it('rejects impossible and malformed dates', () => {
    for (const s of ['2026-02-30', '2025-02-29', '1900-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-9-27', '26-09-27', '2026-09-27T00:00', ''])
      bad(parseLocalDate(s));
  });
});

describe('Instant: "UTC ISO-8601 with Z"', () => {
  it('accepts toISOString output', () => ok(parseInstant('2026-09-27T10:00:00.000Z')));
  it('rejects offsets and dates', () => {
    bad(parseInstant('2026-09-27T10:00:00+02:00'));
    bad(parseInstant('2026-09-27'));
  });
});

describe('ids: lowercase UUID', () => {
  it('accepts lowercase uuid', () => ok(parseItemId('5b0e6c0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c')));
  it('rejects uppercase and junk', () => {
    bad(parseItemId('5B0E6C0A-1D2E-4F3A-9B8C-7D6E5F4A3B2C'));
    bad(parseDeviceId('not-a-uuid'));
  });
});

describe('Hlc: ^\\d{13}-\\d{4}-<uuid>$', () => {
  it('accepts and parses', () => {
    const v = ok(parseHlc('1790000000000-0007-5b0e6c0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c'));
    expect(v).toEqual({ ms: 1790000000000, counter: 7, deviceId: '5b0e6c0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c' });
  });
  it('rejects malformed', () => {
    bad(parseHlc('179000000000-0007-5b0e6c0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c'));
    bad(parseHlc('1790000000000-7-5b0e6c0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c'));
  });
});

describe('previousLocalDate', () => {
  const prev = (s: string) => previousLocalDate(ok(parseLocalDate(s))!);
  it('steps back one calendar day across month, year and leap boundaries', () => {
    expect(prev('2026-09-27')).toBe('2026-09-26');
    expect(prev('2026-03-01')).toBe('2026-02-28');
    expect(prev('2024-03-01')).toBe('2024-02-29');
    expect(prev('2026-01-01')).toBe('2025-12-31');
    expect(prev('2026-05-01')).toBe('2026-04-30');
  });
  it('is unaffected by DST (2026-03-09 → 2026-03-08 in New York)', () => expect(prev('2026-03-09')).toBe('2026-03-08'));
});
