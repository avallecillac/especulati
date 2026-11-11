import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from './themes.ts';
import { SRC, parseTheme } from './theme-files.ts';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(THEMES)('contrast: $id', (theme) => {
  const { tokens } = parseTheme(theme.id);
  const c = (n: string) => tokens.get(n)!;

  it('ink is >= 4.5 on bg and surface', () => {
    expect(ratio(c('ink'), c('bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c('ink'), c('surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('ink-soft is >= 4.5 on bg', () => {
    expect(ratio(c('ink-soft'), c('bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('on-accent is >= 4.5 on accent', () => {
    expect(ratio(c('on-accent'), c('accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it('accent is >= 3 on bg (large text)', () => {
    expect(ratio(c('accent'), c('bg'))).toBeGreaterThanOrEqual(3);
  });

  it('control-border is >= 3 on bg (borders of buttons, inputs, chips and steppers)', () => {
    expect(ratio(c('control-border'), c('bg'))).toBeGreaterThanOrEqual(3);
  });

  it.each(['danger', 'like', 'meh', 'dislike'])('%s is >= 4.5 on bg', (t) => {
    expect(ratio(c(t), c('bg'))).toBeGreaterThanOrEqual(4.5);
  });
});

it('the contrast helper itself is sound', () => {
  expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  expect(readFileSync(join(SRC, 'theme', 'beton.css'), 'utf8')).toContain('--rule');
});
