/**
 * Appearance store (006 contracts/theme-tokens.md). The preference lives in localStorage, is
 * applied to <html data-theme> and the theme-color meta, and follows the system when automatic.
 * The pre-paint script in index.html applies the same rule before first paint.
 */
import { APPEARANCE_KEY } from './frozen.ts';
import { isThemeId, resolveTheme, themeById, type Appearance } from '../theme/themes.ts';

const KEY = APPEARANCE_KEY;
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStored(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    return isThemeId(v) ? v : 'automatic';
  } catch {
    return 'automatic';
  }
}

export const appearance = $state<{ value: Appearance }>({ value: 'automatic' });

function apply(): void {
  const dark = typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
  const id = resolveTheme(appearance.value, dark);
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeById(id).themeColor);
}

export function setAppearance(a: Appearance): void {
  appearance.value = a === 'automatic' || isThemeId(a) ? a : 'automatic';
  try {
    if (appearance.value === 'automatic') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, appearance.value);
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
