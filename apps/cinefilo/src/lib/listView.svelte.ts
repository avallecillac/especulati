import type { VerdictFilter } from '@especulati/cinefilo-core';
import type { ListScope } from '@especulati/cinefilo-db';

/**
 * Which list the list screens show (personal-lists D5), plus the verdict filter, the title search and the scroll
 * position of each list (cinefilo-compact-lists D5). In memory only: every app open starts on Together with nothing
 * filtered, and the choices survive moving between tabs and title screens while the app stays open.
 * `scroll` is keyed by `${tab}:${scope}`.
 */
export const listView = $state<{ scope: ListScope; filter: VerdictFilter | null; query: string; scroll: Record<string, number> }>({
  scope: 'together',
  filter: null,
  query: '',
  scroll: {},
});
