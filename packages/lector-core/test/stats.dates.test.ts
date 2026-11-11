import { describe, expect, it } from 'vitest';
import { dayNumber, fromDayNumber, previousLocalDate } from '../src/index.ts';
import { day } from './fixtures.ts';

describe('dayNumber / fromDayNumber', () => {
  it('matches known anchors', () => {
    expect(dayNumber(day('1970-01-01'))).toBe(0);
    expect(dayNumber(day('2000-03-01'))).toBe(11017);
    expect(dayNumber(day('2026-09-29'))).toBe(20725);
  });

  it('counts consecutive days across leap and year boundaries', () => {
    const consecutive = (...ds: string[]) => {
      for (let i = 1; i < ds.length; i++) expect(dayNumber(day(ds[i]!)) - dayNumber(day(ds[i - 1]!))).toBe(1);
    };
    consecutive('2024-02-28', '2024-02-29', '2024-03-01');
    consecutive('2025-02-28', '2025-03-01');
    consecutive('2025-12-31', '2026-01-01');
  });

  it('round-trips every day from 1999-01-01 to 2031-12-31', () => {
    const start = dayNumber(day('1999-01-01'));
    const end = dayNumber(day('2031-12-31'));
    expect(end - start).toBeGreaterThan(12000);
    for (let n = start; n <= end; n++) expect(dayNumber(fromDayNumber(n))).toBe(n);
    expect(fromDayNumber(start)).toBe('1999-01-01');
    expect(fromDayNumber(end)).toBe('2031-12-31');
    expect(fromDayNumber(0)).toBe('1970-01-01');
  });

  it('agrees with previousLocalDate for 1,000 sampled days', () => {
    const start = dayNumber(day('1999-01-01'));
    const span = dayNumber(day('2031-12-31')) - start;
    let seed = 12345;
    for (let i = 0; i < 1000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const n = start + 1 + (seed % span);
      const d = fromDayNumber(n);
      expect(fromDayNumber(n - 1)).toBe(previousLocalDate(d));
    }
  });
});
