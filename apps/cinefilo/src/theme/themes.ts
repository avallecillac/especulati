/**
 * Theme registry (openspec add-cinefilo-themes, D2). A theme is its CSS file in this folder plus one entry
 * here; `themeColor` repeats the theme's --bg for `<meta name="theme-color">` and a test checks it.
 */
export interface Theme {
  id: string;
  name: string;
  scheme: 'light' | 'dark';
  /** The bar colour, for `<meta name="theme-color">`. */
  themeColor: string;
}

export const THEMES: readonly Theme[] = [
  { id: 'beton', name: 'Béton', scheme: 'light', themeColor: '#d5d1c8' },
  { id: 'willis', name: 'Willis', scheme: 'dark', themeColor: '#0d0b09' },
];

export const DEFAULT_LIGHT = 'beton';
export const DEFAULT_DARK = 'willis';

/** 'automatic' or a theme id; stored values are checked with isThemeId. */
export type Appearance = string;

export const isThemeId = (id: unknown): id is string => typeof id === 'string' && THEMES.some((t) => t.id === id);

/** The theme to show for a stored preference. Unknown values mean automatic. */
export function resolveTheme(pref: unknown, systemDark: boolean): string {
  if (pref !== 'automatic' && isThemeId(pref)) return pref;
  return systemDark ? DEFAULT_DARK : DEFAULT_LIGHT;
}

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]!;
