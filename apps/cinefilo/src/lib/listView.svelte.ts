import type { ListScope } from '@especulati/cinefilo-db';

/**
 * Which list the list screens show (personal-lists D5). In memory only: every app open starts on Together, and the
 * choice survives moving between tabs and title screens while the app stays open.
 */
export const listView = $state<{ scope: ListScope }>({ scope: 'together' });
