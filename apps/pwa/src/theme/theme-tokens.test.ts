import { describe, expect, it } from 'vitest';
import { THEMES } from './themes.ts';
import { COLOUR_TOKENS, OTHER_TOKENS, parseTheme } from './theme-files.ts';

const expected = [...COLOUR_TOKENS, ...OTHER_TOKENS].sort();

describe.each(THEMES)('theme $id', (theme) => {
  const { tokens, others, rules } = parseTheme(theme.id);

  it('sets exactly the contract tokens', () => {
    expect([...tokens.keys()].sort()).toEqual(expected);
  });

  it('is one rule, and only color-scheme besides the tokens', () => {
    expect(rules).toBe(1);
    expect(others).toEqual(['color-scheme']);
  });

  it('scheme token matches the registry', () => {
    expect(tokens.get('scheme')).toBe(theme.scheme);
  });

  it('registry swatch and themeColor equal the CSS', () => {
    const v = (n: string) => tokens.get(n)!.toLowerCase();
    expect(theme.swatch.map((s) => s.toLowerCase())).toEqual([v('paper'), v('accent'), v('ornament')]);
    expect(theme.themeColor.toLowerCase()).toBe(v('paper'));
  });
});
