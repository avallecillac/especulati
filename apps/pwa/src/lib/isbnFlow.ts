import type { BookCard } from '@readerlog/db';
import type { Isbn13 } from '@readerlog/core';
import { lookupIsbn } from '../catalog/isbnLookup.ts';
import { draft, type Draft } from './draft.svelte.ts';
import { query } from './dbClient.ts';
import { navigate } from './router.svelte.ts';

export type IsbnFlowResult = { kind: 'duplicate'; existing: BookCard } | { kind: 'started' };

/**
 * ISBN in hand (scanned or typed): check for a duplicate, then show the Add screen
 * and look the details up in the background. Saving never waits on the lookup.
 */
export async function startIsbnFlow(
  isbn: string,
  opts: { skipDuplicateCheck?: boolean; source?: Draft['source'] } = {},
): Promise<IsbnFlowResult> {
  if (!opts.skipDuplicateCheck) {
    const r = await query({ name: 'findByIsbn', isbn });
    if (r.ok && r.value) return { kind: 'duplicate', existing: r.value };
  }

  const mine: Draft = { source: opts.source ?? 'scan', isbn, lookup: 'running', details: null };
  if (opts.skipDuplicateCheck) mine.allowDuplicate = true;
  draft.current = mine;
  navigate('/add');

  void lookupIsbn(isbn as Isbn13, { fetch: (u, i) => fetch(u, i), online: () => navigator.onLine }).then((outcome) => {
    // Stale if the user saved, left, or started another flow meanwhile.
    const cur = draft.current;
    if (!cur || cur.isbn !== isbn || cur.lookup !== 'running' || cur.source !== mine.source) return;
    cur.lookup = outcome.kind;
    if (outcome.kind === 'found') cur.details = outcome.details;
  });
  return { kind: 'started' };
}
