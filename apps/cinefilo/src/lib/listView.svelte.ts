import type { ListScope } from '@especulati/cinefilo-db';

/**
 * Which list the list screens show (personal-lists D5), plus the title search and the scroll
 * position of each list (cinefilo-compact-lists D5). In memory only: every app open starts on Together with nothing
 * searched, and the choices survive moving between tabs and title screens while the app stays open.
 * `scroll` is keyed by `${tab}:${scope}`.
 */
export const listView = $state<{ scope: ListScope; query: string; scroll: Record<string, number> }>({
  scope: 'together',
  query: '',
  scroll: {},
});
