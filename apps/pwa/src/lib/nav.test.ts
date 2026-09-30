import { describe, expect, it } from 'vitest';
import type { Route } from './router.svelte.ts';
import { depth, parent } from './nav.ts';

const cases: Array<[Route, { label: string; href: string } | null, number]> = [
  [{ name: 'home' }, null, 0],
  [{ name: 'library' }, null, 0],
  [{ name: 'add' }, null, 0],
  [{ name: 'stats' }, null, 0],
  [{ name: 'settings' }, null, 0],
  [{ name: 'articles' }, null, 0],
  [{ name: 'book', id: 'b1' }, { label: 'Library', href: '#/library' }, 1],
  [{ name: 'edit', id: 'b 1' }, { label: 'Book', href: '#/book/b%201' }, 2],
  [{ name: 'article', id: 'a1' }, { label: 'Articles', href: '#/articles' }, 1],
  [{ name: 'scan' }, { label: 'Add', href: '#/add' }, 1],
  [{ name: 'search' }, { label: 'Add', href: '#/add' }, 1],
  [{ name: 'isbn' }, { label: 'Add', href: '#/add' }, 1],
  [{ name: 'sync' }, { label: 'Settings', href: '#/settings' }, 1],
  [{ name: 'duplicates' }, { label: 'Sync', href: '#/settings/sync' }, 2],
  [{ name: 'capture', d: 'x' }, { label: 'Library', href: '#/library' }, 1],
];

describe('nav', () => {
  it.each(cases)('parent and depth of %j', (route, p, d) => {
    expect(parent(route)).toEqual(p);
    expect(depth(route)).toBe(d);
  });
});
