import { describe, expect, it } from 'vitest';
import { currentStreak, longestStreak, type LocalDate } from '../src/index.ts';
import { day } from './fixtures.ts';

const set = (...ds: string[]): Set<LocalDate> => new Set(ds.map(day));

describe('currentStreak', () => {
  it('today plus the 2 days before is 3', () => {
    expect(currentStreak(set('2026-06-13', '2026-06-14', '2026-06-15'), day('2026-06-15'))).toEqual({
      start: '2026-06-13',
      end: '2026-06-15',
      length: 3,
    });
  });
  it('yesterday and the day before, not today, is still alive: 2', () => {
    expect(currentStreak(set('2026-06-13', '2026-06-14'), day('2026-06-15'))).toEqual({
      start: '2026-06-13',
      end: '2026-06-14',
      length: 2,
    });
  });
  it('a last day 2 days ago is null', () => {
    expect(currentStreak(set('2026-06-13'), day('2026-06-15'))).toBeNull();
  });
  it('a future day is ignored', () => {
    expect(currentStreak(set('2026-06-14', '2026-06-15', '2026-06-18'), day('2026-06-15'))).toEqual({
      start: '2026-06-14',
      end: '2026-06-15',
      length: 2,
    });
    expect(currentStreak(set('2026-06-18'), day('2026-06-15'))).toBeNull();
  });
  it('spans a year boundary', () => {
    expect(currentStreak(set('2025-12-31', '2026-01-01'), day('2026-01-01'))).toEqual({
      start: '2025-12-31',
      end: '2026-01-01',
      length: 2,
    });
  });
  it('empty is null', () => {
    expect(currentStreak(set(), day('2026-06-15'))).toBeNull();
  });
});

describe('longestStreak', () => {
  it('Dec 30 to Jan 2 is 4 with the right ends', () => {
    expect(longestStreak(set('2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'))).toEqual({
      start: '2025-12-30',
      end: '2026-01-02',
      length: 4,
    });
  });
  it('counts future days', () => {
    expect(longestStreak(set('2026-06-15', '2026-06-18', '2026-06-19', '2026-06-20'))).toEqual({
      start: '2026-06-18',
      end: '2026-06-20',
      length: 3,
    });
  });
  it('of two equal runs the most recent wins', () => {
    expect(longestStreak(set('2026-01-01', '2026-01-02', '2026-03-05', '2026-03-06', '2026-02-01'))).toEqual({
      start: '2026-03-05',
      end: '2026-03-06',
      length: 2,
    });
  });
  it('a longer earlier run beats a shorter later one', () => {
    expect(longestStreak(set('2026-01-01', '2026-01-02', '2026-01-03', '2026-03-05'))?.length).toBe(3);
  });
  it('empty is null', () => {
    expect(longestStreak(set())).toBeNull();
  });
});
