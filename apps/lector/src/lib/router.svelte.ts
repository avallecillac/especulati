import { flushSync } from 'svelte';
import { depth, type Route } from './nav.ts';

/** Minimal hash router (research R3): five screens don't justify a dependency. */
export type { Route };

export function parseHash(hash: string): Route {
  const full = hash.replace(/^#/, '') || '/';
  const q = full.indexOf('?');
  const path = q === -1 ? full : full.slice(0, q);
  const query = q === -1 ? '' : full.slice(q + 1);
  const [, head = '', arg = '', arg2 = ''] = path.split('/');
  switch (head) {
    case '':
      return { name: 'home' };
    case 'add':
      return { name: 'add' };
    case 'scan':
      return { name: 'scan' };
    case 'search':
      return { name: 'search' };
    case 'isbn':
      return { name: 'isbn' };
    case 'capture':
      return { name: 'capture', d: /(?:^|&)d=([^&]*)/.exec(query)?.[1] ?? '' };
    case 'articles':
      return { name: 'articles' };
    case 'article':
      return arg ? { name: 'article', id: decodeURIComponent(arg) } : { name: 'articles' };
    case 'library':
      return { name: 'library' };
    case 'stats':
      return { name: 'stats' };
    case 'settings':
      return arg === 'sync' ? (arg2 === 'duplicates' ? { name: 'duplicates' } : { name: 'sync' }) : { name: 'settings' };
    case 'book':
      return arg ? { name: 'book', id: decodeURIComponent(arg) } : { name: 'library' };
    case 'edit':
      return arg ? { name: 'edit', id: decodeURIComponent(arg) } : { name: 'library' };
    default:
      return { name: 'home' };
  }
}

export const router = $state<{ route: Route; /** The hash we came from in this session (null on first load). */ previousHash: string | null }>({
  route: parseHash(location.hash),
  previousHash: null,
});

let currentHash = location.hash;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Apply a route change, with a push/pop view transition when the depth changes (006 ui-shell.md). */
function applyRoute(next: Route): void {
  const prev = router.route;
  const apply = () => {
    router.route = next;
    flushSync();
  };
  const d = depth(next) - depth(prev);
  if (reducedMotion()) {
    apply();
    // Reduce Motion: a short fade instead of the slide.
    if (prev.name !== next.name) document.querySelector('main')?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    return;
  }
  if (d === 0 || typeof document.startViewTransition !== 'function') {
    apply();
    return;
  }
  const root = document.documentElement;
  root.classList.add(d > 0 ? 'vt-push' : 'vt-pop');
  const done = () => root.classList.remove('vt-push', 'vt-pop');
  const t = document.startViewTransition(apply);
  void t.finished.then(done, done);
}

window.addEventListener('hashchange', () => {
  router.previousHash = currentHash;
  currentHash = location.hash;
  applyRoute(parseHash(location.hash));
});

export function navigate(path: string): void {
  location.hash = path;
}
