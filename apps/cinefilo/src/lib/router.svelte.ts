import type { ListTab } from '@especulati/cinefilo-db';

export type Route = { name: 'list'; tab: ListTab } | { name: 'title'; id: string } | { name: 'settings' };

const TABS: readonly string[] = ['later', 'watching', 'watched'];

/** Minimal hash router: `#/later`, `#/watching`, `#/watched`, `#/title/<id>`, `#/settings`. */
export function parseHash(hash: string): Route {
  const [, head = '', arg = ''] = hash.replace(/^#/, '').split('/');
  if (head === 'settings') return { name: 'settings' };
  if (head === 'title' && arg) return { name: 'title', id: decodeURIComponent(arg) };
  if (TABS.includes(head)) return { name: 'list', tab: head as ListTab };
  return { name: 'list', tab: 'later' };
}

export const router = $state<{ route: Route }>({ route: parseHash(location.hash) });

window.addEventListener('hashchange', () => {
  router.route = parseHash(location.hash);
});

export const navigate = (path: string): void => {
  location.hash = path;
};
