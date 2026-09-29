import type { Item } from './book.ts';
import type { ItemId } from './types.ts';

export interface DuplicatePair {
  readonly survivor: ItemId;
  readonly duplicate: ItemId;
  readonly reason: 'isbn' | 'titleAuthor';
}

/** NFD, strip combining marks, lowercase, punctuation to space, collapse whitespace (research R8). */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const key = (i: Item): string => `${normalizeForMatch(i.title)}|${normalizeForMatch(i.author ?? '')}`;
const earlier = (a: Item, b: Item): boolean => (a.createdAt !== b.createdAt ? a.createdAt < b.createdAt : a.id < b.id);

/**
 * Pairs of live books that look like the same book. The same ISBN always matches; two different
 * ISBNs never do; otherwise (an ISBN missing) equal normalized title + author match. The
 * survivor is the smaller (createdAt, id), the same on every device. Each pair appears once.
 */
export function findDuplicates(
  items: readonly Item[],
  dismissed: readonly { readonly itemA: string; readonly itemB: string }[],
): DuplicatePair[] {
  const skip = new Set(dismissed.map((d) => (d.itemA < d.itemB ? `${d.itemA}|${d.itemB}` : `${d.itemB}|${d.itemA}`)));
  const live = items.filter((i) => i.deletedAt === null && i.type === 'book').sort((a, b) => (earlier(a, b) ? -1 : 1));
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      let reason: DuplicatePair['reason'] | null = null;
      if (a.isbn !== null && b.isbn !== null) reason = a.isbn === b.isbn ? 'isbn' : null;
      else if (key(a) === key(b)) reason = 'titleAuthor';
      if (reason === null) continue;
      if (skip.has(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`)) continue;
      pairs.push({ survivor: a.id, duplicate: b.id, reason });
    }
  }
  return pairs;
}
