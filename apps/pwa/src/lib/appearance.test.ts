import { describe, expect, it } from 'vitest';
import { DEFAULT_DARK, DEFAULT_LIGHT, THEMES, resolveTheme, themeById } from '../theme/themes.ts';

describe('resolveTheme', () => {
  it('automatic follows the system', () => {
    expect(resolveTheme('automatic', false)).toBe(DEFAULT_LIGHT);
    expect(resolveTheme('automatic', true)).toBe(DEFAULT_DARK);
  });

  it.each(THEMES.map((t) => t.id))('explicit %s wins over the system', (id) => {
    expect(resolveTheme(id, false)).toBe(id);
    expect(resolveTheme(id, true)).toBe(id);
  });

  it.each([null, undefined, '', 'nope', 42, {}])('invalid value %j means automatic', (v) => {
    expect(resolveTheme(v, false)).toBe(DEFAULT_LIGHT);
    expect(resolveTheme(v, true)).toBe(DEFAULT_DARK);
  });

  it('themeById falls back to the first theme', () => {
    expect(themeById('patriarca').scheme).toBe('dark');
    expect(themeById('nope').id).toBe(THEMES[0]!.id);
  });
});
