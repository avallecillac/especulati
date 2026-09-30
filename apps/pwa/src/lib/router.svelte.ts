/** Minimal hash router (research R3): five screens don't justify a dependency. */
export type Route =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'scan' }
  | { name: 'search' }
  | { name: 'isbn' }
  | { name: 'edit'; id: string }
  | { name: 'library' }
  | { name: 'book'; id: string }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'sync' }
  | { name: 'duplicates' }
  | { name: 'articles' }
  | { name: 'article'; id: string }
  /** `d` is the raw text after `d=` (still URL-encoded); decodeCapture handles it. */
  | { name: 'capture'; d: string };

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

export const router = $state<{ route: Route }>({ route: parseHash(location.hash) });

window.addEventListener('hashchange', () => {
  router.route = parseHash(location.hash);
});

export function navigate(path: string): void {
  location.hash = path;
}
