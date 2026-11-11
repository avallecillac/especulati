/**
 * Appearance store (openspec add-cinefilo-themes, D2). The preference lives in localStorage on this
 * device only, is applied to <html data-theme> and the theme-color meta, and follows the system while
 * automatic. The pre-paint script in index.html applies the same rule before first paint.
 */
import { APPEARANCE_KEY } from '../theme/frozen.ts';
import { isThemeId, resolveTheme, themeById, type Appearance } from '../theme/themes.ts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStored(): Appearance {
  try {
    const v = localStorage.getItem(APPEARANCE_KEY);
    return isThemeId(v) ? v : 'automatic';
  } catch {
    return 'automatic';
  }
}

export const appearance = $state<{ value: Appearance }>({ value: 'automatic' });

/** The theme on screen right now (a theme id, never 'automatic'); art and covers follow it. */
export const theme = $state<{ id: string }>({ id: document.documentElement.dataset['theme'] ?? 'beton' });

function apply(): void {
  const dark = typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
  const id = resolveTheme(appearance.value, dark);
  document.documentElement.dataset['theme'] = id;
  theme.id = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeById(id).themeColor);
}

export function setAppearance(a: Appearance): void {
  appearance.value = a === 'automatic' || isThemeId(a) ? a : 'automatic';
  try {
    if (appearance.value === 'automatic') localStorage.removeItem(APPEARANCE_KEY);
    else localStorage.setItem(APPEARANCE_KEY, appearance.value);
  } catch {
    // blocked storage: the choice lasts for this session only
  }
  apply();
}

/** Called once from main.ts: read the stored value and follow system changes while automatic. */
export function initAppearance(): void {
  appearance.value = readStored();
  apply();
  if (typeof matchMedia === 'function') {
    matchMedia(DARK_QUERY).addEventListener('change', () => {
      if (appearance.value === 'automatic') apply();
    });
  }
}
