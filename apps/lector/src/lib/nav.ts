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

export interface Parent {
  label: string;
  href: string;
}

/** The screen a route's back control leads to (006 contracts/ui-shell.md); null for top-level routes. */
export function parent(route: Route): Parent | null {
  switch (route.name) {
    case 'book':
    case 'capture':
      return { label: 'Library', href: '#/library' };
    case 'edit':
      return { label: 'Book', href: `#/book/${encodeURIComponent(route.id)}` };
    case 'article':
      return { label: 'Articles', href: '#/articles' };
    case 'scan':
    case 'search':
    case 'isbn':
      return { label: 'Add', href: '#/add' };
    case 'sync':
      return { label: 'Settings', href: '#/settings' };
    case 'duplicates':
      return { label: 'Sync', href: '#/settings/sync' };
    default:
      return null;
  }
}

/** Navigation depth: 0 top level, 1 a detail or flow screen, 2 a screen under that. */
export function depth(route: Route): number {
  switch (route.name) {
    case 'edit':
    case 'duplicates':
      return 2;
    case 'book':
    case 'article':
    case 'scan':
    case 'search':
    case 'isbn':
    case 'sync':
    case 'capture':
      return 1;
    default:
      return 0;
  }
}
