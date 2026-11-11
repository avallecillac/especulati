// Reconcile a saved article with a later copy of the same URL (008 research R4, invariant R-1).
// Runs inside the DB worker only (it reads the DB directly); the UI never imports it.
//
// Every id is derived from content, so two devices reconciling the same pair produce the same
// rows. The ids use the same labels as the convergence test (packages/sync/test/convergence.test.ts).

import type { DispatchEnv, LectorDb } from '@especulati/lector-db';
import { HL_COPY_LABEL, ITEM_TAG_ID_LABEL } from './frozen.ts';
import { uuidFromHash } from './ids.ts';

/** Content-addressed copy of one highlight onto the survivor (as 004's merge copies). */
export const highlightCopyId = (
  survivorId: string,
  h: { quote: string | null; note: string | null; page: number | null; createdAt: string; localDate: string },
): Promise<string> => uuidFromHash(`${HL_COPY_LABEL}|${survivorId}|${JSON.stringify([h.quote, h.note, h.page, h.createdAt, h.localDate])}`);

/** The assignment of a tag to an article (research R3). */
export const itemTagId = (itemId: string, tagId: string): Promise<string> => uuidFromHash(`${ITEM_TAG_ID_LABEL}|${itemId}|${tagId}`);

/** A TEXT column; anything else means the schema changed. */
function str(v: unknown): string {
  if (typeof v !== 'string') throw new TypeError('reconcile: expected a TEXT column');
  return v;
}

export interface ReconcilePair {
  readonly survivorId: string;
  readonly duplicateId: string;
}

/**
 * The first pair to reconcile, or null. Per URL, in (created_at, id) order:
 * - two or more live saved articles: the earliest absorbs the next one;
 * - one saved article: it absorbs the first read article created after it. A read article created
 *   before the save is a re-read, not a duplicate.
 */
export function findReconcilePair(db: LectorDb): ReconcilePair | null {
  const rows = db.raw.selectArrays(
    `SELECT id, url, read_on FROM items
      WHERE type = 'article' AND deleted_at IS NULL AND url IN (
        SELECT url FROM items WHERE type = 'article' AND deleted_at IS NULL AND url IS NOT NULL
        GROUP BY url HAVING COUNT(*) > 1 AND SUM(read_on IS NULL) > 0)
      ORDER BY url, created_at, id`,
  );
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j]![1] === rows[i]![1]) j++;
    const group = rows.slice(i, j);
    i = j;
    const saved = group.filter((r) => r[2] === null);
    const first = saved[0];
    if (!first) continue;
    if (saved[1]) return { survivorId: str(first[0]), duplicateId: str(saved[1][0]) };
    const later = group.slice(group.indexOf(first) + 1).find((r) => r[2] !== null);
    if (later) return { survivorId: str(first[0]), duplicateId: str(later[0]) };
  }
  return null;
}

/** Build and dispatch the command for one pair. Returns false when decide() refused it. */
export async function reconcilePair(db: LectorDb, pair: ReconcilePair, env: DispatchEnv): Promise<boolean> {
  const highlights = db.raw
    .selectObjects('SELECT id, quote, note, page, created_at, local_date FROM highlights WHERE item_id = ? AND deleted_at IS NULL ORDER BY id', [pair.duplicateId])
    .map((h) => ({
      id: str(h['id']),
      quote: (h['quote'] as string | null) ?? null,
      note: (h['note'] as string | null) ?? null,
      page: (h['page'] as number | null) ?? null,
      createdAt: str(h['created_at']),
      localDate: str(h['local_date']),
    }));
  const copies = await Promise.all(highlights.map(async (h) => ({ from: h.id, to: await highlightCopyId(pair.survivorId, h) })));
  const assignments = db.raw.selectObjects('SELECT id, tag_id FROM item_tags WHERE item_id = ? AND deleted_at IS NULL ORDER BY id', [pair.duplicateId]);
  const tagMoves = await Promise.all(
    assignments.map(async (a) => ({ from: str(a['id']), to: await itemTagId(pair.survivorId, str(a['tag_id'])), itemId: pair.survivorId })),
  );
  return db.dispatch({ kind: 'ReconcileSavedArticle', survivorId: pair.survivorId, duplicateId: pair.duplicateId, copies, tagMoves }, env).ok;
}

/**
 * Reconcile until no pair is left. Idempotent: the duplicate is tombstoned, so a second run finds nothing.
 * Each pass removes one live article, so the loop ends; it stops early if a pair is refused.
 */
export async function reconcileAll(db: LectorDb, env: () => DispatchEnv): Promise<number> {
  let done = 0;
  for (;;) {
    const pair = findReconcilePair(db);
    if (!pair || !(await reconcilePair(db, pair, env()))) return done;
    done++;
  }
}
