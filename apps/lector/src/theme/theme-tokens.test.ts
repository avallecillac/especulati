import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from './themes.ts';
import { COLOUR_TOKENS, OTHER_TOKENS, SRC, parseTheme, parseThemeFile } from './theme-files.ts';

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

// US4 / FR-021: a new theme needs only a CSS file with the same tokens plus a registry entry.
describe('test-only theme fixture', () => {
  const { tokens, others, rules } = parseThemeFile(join(SRC, 'theme', 'test-fixtures', 'test-theme.css'));

  it('passes the same completeness check as the real themes', () => {
    expect([...tokens.keys()].sort()).toEqual(expected);
    expect(rules).toBe(1);
    expect(others).toEqual(['color-scheme']);
  });
});

it('the completeness check rejects a theme with a missing token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theme-'));
  const file = join(dir, 'bad.css');
  const css = readFileSync(join(SRC, 'theme', 'test-fixtures', 'test-theme.css'), 'utf8').replace(/^\s*--ornament:.*$/m, '');
  writeFileSync(file, css);
  expect([...parseThemeFile(file).tokens.keys()].sort()).not.toEqual(expected);
});
