import { describe, expect, it } from 'vitest';
import { THEMES } from './themes.ts';
import { parseTheme } from './theme-files.ts';

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

  it.each(['ink', 'ink-soft', 'accent', 'danger'])('%s is >= 4.5 on paper and leaf', (t) => {
    expect(ratio(c(t), c('paper'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c(t), c('leaf'))).toBeGreaterThanOrEqual(4.5);
  });

  it('on-accent is >= 4.5 on accent', () => {
    expect(ratio(c('on-accent'), c('accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it('ornament is >= 3 on paper', () => {
    expect(ratio(c('ornament'), c('paper'))).toBeGreaterThanOrEqual(3);
  });

  it.each([1, 2, 3, 4, 5, 6])('on-cloth is >= 4.5 on cloth-%i', (n) => {
    expect(ratio(c('on-cloth'), c(`cloth-${n}`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([1, 2, 3, 4])('heat-%i is >= 1.15 from the previous step', (n) => {
    expect(ratio(c(`heat-${n}`), c(`heat-${n - 1}`))).toBeGreaterThanOrEqual(1.15);
  });
});
