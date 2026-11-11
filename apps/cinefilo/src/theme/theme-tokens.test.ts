import { describe, expect, it } from 'vitest';
import { THEMES } from './themes.ts';
import { COLOUR_TOKENS, OTHER_TOKENS, parseTheme, selectorOf } from './theme-files.ts';

const expected = [...COLOUR_TOKENS, ...OTHER_TOKENS].sort();

describe.each(THEMES)('theme $id', (theme) => {
  const { tokens, others, rules } = parseTheme(theme.id);

  it('sets exactly the contract tokens', () => {
    expect([...tokens.keys()].sort()).toEqual(expected);
  });

  it('is one :root[data-theme] rule, and only color-scheme besides the tokens', () => {
    expect(rules).toBe(1);
    expect(selectorOf(theme.id)).toBe(`:root[data-theme='${theme.id}']`);
    expect(others).toEqual(['color-scheme']);
  });

  it('registry themeColor equals --bg', () => {
    expect(theme.themeColor.toLowerCase()).toBe(tokens.get('bg')!.toLowerCase());
  });
});

it('registers exactly beton (light) and willis (dark)', () => {
  expect(THEMES.map((t) => [t.id, t.scheme])).toEqual([['beton', 'light'], ['willis', 'dark']]);
});
