import { describe, expect, it } from 'vitest';
import { compareHlc, hlcNext } from '../src/index.ts';
import { deviceId } from './fixtures.ts';

const dev = deviceId(1);

describe('hlcNext', () => {
  it('formats %013d-%04d-<deviceId>', () => {
    expect(hlcNext(null, 1790000000000, dev)).toBe(`1790000000000-0000-${dev}`);
    expect(hlcNext(null, 5, dev)).toBe(`0000000000005-0000-${dev}`);
  });

  it('uses the wall clock when it moves forward', () => {
    const a = hlcNext(null, 1000, dev);
    expect(hlcNext(a, 2000, dev)).toBe(`0000000002000-0000-${dev}`);
  });

  it('increments the counter when the wall clock repeats', () => {
    const a = hlcNext(null, 1000, dev);
    const b = hlcNext(a, 1000, dev);
    expect(b).toBe(`0000000001000-0001-${dev}`);
  });

  it('stays monotonic when the wall clock goes backwards', () => {
    const a = hlcNext(null, 5000, dev);
    const b = hlcNext(a, 1000, dev);
    expect(b).toBe(`0000000005000-0001-${dev}`);
    expect(compareHlc(a, b)).toBeLessThan(0);
  });

  it('carries into ms when the counter overflows', () => {
    const full = `0000000001000-9999-${dev}` as ReturnType<typeof hlcNext>;
    expect(hlcNext(full, 1000, dev)).toBe(`0000000001001-0000-${dev}`);
  });

  it('lexicographic order equals causal order across a long sequence', () => {
    let prev = hlcNext(null, 100, dev);
    const walls = [100, 100, 99, 250, 250, 10, 300];
    for (const w of walls) {
      const next = hlcNext(prev, w, dev);
      expect(next > prev).toBe(true);
      expect(compareHlc(prev, next)).toBe(-1);
      prev = next;
    }
  });
});
