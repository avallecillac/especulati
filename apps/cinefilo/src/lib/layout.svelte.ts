/**
 * Device-local list display choices (cinefilo-feedback-1 D5): list or grid, and the Together Watched order. localStorage
 * only, never synced or exported; the keys are frozen (theme/frozen.ts).
 */
import { LAYOUT_KEY, WATCHED_ORDER_KEY } from '../theme/frozen.ts';

export type Layout = 'list' | 'grid';
export type WatchedOrder = 'newest' | 'first';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string, fallback: string): void {
  try {
    if (value === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // blocked storage: the choice lasts for this session only
  }
}

export const display = $state<{ layout: Layout; watchedOrder: WatchedOrder }>({
  layout: read<Layout>(LAYOUT_KEY, ['list', 'grid'], 'list'),
  watchedOrder: read<WatchedOrder>(WATCHED_ORDER_KEY, ['newest', 'first'], 'newest'),
});

export function setLayout(l: Layout): void {
  display.layout = l === 'grid' ? 'grid' : 'list';
  write(LAYOUT_KEY, display.layout, 'list');
}

export function setWatchedOrder(o: WatchedOrder): void {
  display.watchedOrder = o === 'first' ? 'first' : 'newest';
  write(WATCHED_ORDER_KEY, display.watchedOrder, 'newest');
}
