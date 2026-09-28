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
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const [, head = '', arg = ''] = path.split('/');
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
    case 'library':
      return { name: 'library' };
    case 'settings':
      return { name: 'settings' };
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
