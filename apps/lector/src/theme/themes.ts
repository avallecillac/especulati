/**
 * Theme registry (006 contracts/theme-tokens.md). A theme is its CSS file in this folder plus
 * one entry here; `swatch` and `themeColor` repeat token values for the picker and the
 * `theme-color` meta, and a test checks they match the CSS.
 */
export interface Theme {
  id: string;
  name: string;
  scheme: 'light' | 'dark';
  /** paper, accent, ornament */
  swatch: readonly [string, string, string];
  /** The bar colour, for `<meta name="theme-color">`. */
  themeColor: string;
}

export const THEMES: readonly Theme[] = [
  { id: 'macondo', name: 'Macondo', scheme: 'light', swatch: ['#f3ecdd', '#2e6a5c', '#a8651f'], themeColor: '#f3ecdd' },
  { id: 'patriarca', name: 'Patriarca', scheme: 'dark', swatch: ['#15100e', '#cfa75a', '#b8904a'], themeColor: '#15100e' },
];

export const DEFAULT_LIGHT = 'macondo';
export const DEFAULT_DARK = 'patriarca';

/** 'automatic' or a theme id; stored values are checked with isThemeId. */
export type Appearance = string;

export const isThemeId = (id: unknown): id is string => typeof id === 'string' && THEMES.some((t) => t.id === id);

/** The theme to show for a stored preference (data-model.md). Unknown values mean automatic. */
export function resolveTheme(pref: unknown, systemDark: boolean): string {
  if (pref !== 'automatic' && isThemeId(pref)) return pref;
  return systemDark ? DEFAULT_DARK : DEFAULT_LIGHT;
}

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]!;
