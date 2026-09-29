import type { Isbn13 } from '@readerlog/core';
import { lookupIsbn } from '../catalog/isbnLookup.ts';
import { fetchCover } from '../catalog/cover.ts';
import { authorsLabel } from '../catalog/merge.ts';
import { settings } from './settings.svelte.ts';
import { dispatch, query, storeCover } from './dbClient.ts';

const CONCURRENCY = 2;

/**
 * Items already tried this launch (FR-009: at most once per launch per book). A lookup that
 * never reached the network (device offline) is not an attempt, so it doesn't count.
 */
const attempted = new Set<string>();
let running = false;

/** Returns false when no request was made (offline), so the item can be tried again this launch. */
async function retryOne(itemId: string, isbn: string): Promise<boolean> {
  const outcome = await lookupIsbn(isbn as Isbn13, { fetch: (u, i) => fetch(u, i), online: () => navigator.onLine, googleApiKey: settings.googleBooksKey });
  if (outcome.kind === 'unavailable' && outcome.reason === 'offline') return false;
  if (outcome.kind === 'notFound') {
    await dispatch({ kind: 'FillDetails', itemId, outcome: 'notFound' });
    return true;
  }
  if (outcome.kind !== 'found') return true;

  const d = outcome.details;
  const book = await query({ name: 'book', itemId });
  const hadCover = book.ok && book.value !== null && book.value.card.hasCover;
  const r = await dispatch({
    kind: 'FillDetails',
    itemId,
    outcome: 'found',
    details: {
      ...(d.title ? { title: d.title } : {}),
      author: authorsLabel(d.authors),
      totalPages: d.totalPages,
      genre: d.genre,
      coverUrl: d.coverUrl,
    },
  });
  if (r.ok && !hadCover && d.coverUrl) {
    const blob = await fetchCover(d.coverUrl, { fetch: (u, i) => fetch(u, i) });
    if (blob) await storeCover(itemId, blob);
  }
  return true;
}

/** Fill in books saved while the catalog couldn't help (R8). Never overwrites user edits: decide() enforces that. */
export async function runDetailsRetry(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await query({ name: 'pendingDetails' });
    if (!r.ok) return;
    const todo = r.value.filter((p) => !attempted.has(p.itemId));
    for (const p of todo) attempted.add(p.itemId);
    const queue = [...todo];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        try {
          if (!(await retryOne(p.itemId, p.isbn))) attempted.delete(p.itemId);
        } catch {
          // Stays pending; the next launch tries again.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  } finally {
    running = false;
  }
}
