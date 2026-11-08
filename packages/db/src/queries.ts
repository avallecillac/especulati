import type { SqlValue } from '@sqlite.org/sqlite-wasm';
import type { Article, Author, BookStatus, DetailsStatus, EventType, Instant, ItemId, LocalDate, NonEmptyTitle, NormalizedUrl, WordCount } from '@readerlog/core';
import { detailsStatusFromDb } from '@readerlog/core';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { pace as computePace, readThroughs as computeReadThroughs, type Pace } from '@readerlog/core';
import { deriveStatus, eventOrder, findDuplicates, lastActivity, lastPage, type Item, type ReadingEvent } from '@readerlog/core';
import type { Highlight } from '@readerlog/core';
import { intOrNull, loadBookSnapshot, mergeChainIds, rowToEvent, rowToHighlight, rowToItem, text, textOrNull } from './snapshot.ts';

/** Read models returned to the UI (contracts/worker-api.md). Plain JSON: nulls, no brands. */
export interface BookCard {
  itemId: string;
  title: string;
  author: string | null;
  totalPages: number | null;
  genre: string | null;
  isbn: string | null;
  detailsStatus: DetailsStatus;
  hasCover: boolean;
  status: BookStatus;
  lastPage: number | null;
  lastActivity: { localDate: string; occurredAt: string } | null;
}

export interface HomeView {
  current: BookCard | null;
  otherReading: BookCard[];
  queuedCount: number;
}

export interface LibraryView {
  reading: BookCard[];
  queued: BookCard[];
  finished: BookCard[];
  abandoned: BookCard[];
}

export interface BookEventView {
  id: string;
  type: EventType;
  page: number | null;
  localDate: string;
  occurredAt: string;
}

export interface BookView {
  card: BookCard;
  /** Non-deleted events, newest first. */
  events: BookEventView[];
  /** Pace and estimated finish for a book being read; null otherwise (003 US3). */
  pace: Pace | null;
  /** Finished read-throughs only, newest first (003 US4). */
  readThroughs: { start: string; end: string; daysToFinish: number }[];
}


function toCard(item: Item, events: readonly ReadingEvent[], hasCover: boolean): BookCard {
  return {
    itemId: item.id,
    title: item.title,
    author: item.author,
    totalPages: item.totalPages,
    genre: item.genre,
    isbn: item.isbn,
    detailsStatus: item.detailsStatus,
    hasCover,
    status: deriveStatus(events),
    lastPage: lastPage(events),
    lastActivity: lastActivity(events),
  };
}

const coverIds = (db: Database): Set<string> =>
  new Set(db.selectValues('SELECT item_id FROM covers').map(String));

/** All non-deleted books with their events: two queries, grouped in memory (≈100 books/decade). */
function loadBooks(db: Database): { card: BookCard; events: ReadingEvent[] }[] {
  const items = db.selectObjects(`SELECT * FROM items WHERE type = 'book' AND deleted_at IS NULL`).map(rowToItem);
  const covered = coverIds(db);
  const byItem = new Map<string, ReadingEvent[]>(items.map((i) => [i.id, []]));
  for (const row of db.selectObjects(
    `SELECT e.* FROM reading_events e JOIN items i ON i.id = e.item_id
     WHERE i.type = 'book' AND i.deleted_at IS NULL AND e.deleted_at IS NULL`,
  )) {
    const e = rowToEvent(row);
    byItem.get(e.itemId)?.push(e);
  }
  return items.map((item) => {
    const events = byItem.get(item.id) ?? [];
    return { events, card: toCard(item, events, covered.has(item.id)) };
  });
}

/** Most recent activity first; ties by title for a stable order. */
const activityKey = (c: BookCard) => (c.lastActivity ? `${c.lastActivity.localDate}|${c.lastActivity.occurredAt}` : '');
const byRecent = (a: BookCard, b: BookCard) => activityKey(b).localeCompare(activityKey(a)) || a.title.localeCompare(b.title);

export function homeView(db: Database): HomeView {
  const cards = loadBooks(db).map((b) => b.card);
  const reading = cards.filter((c) => c.status === 'reading').sort(byRecent);
  return {
    current: reading[0] ?? null,
    otherReading: reading.slice(1),
    queuedCount: cards.filter((c) => c.status === 'queued').length,
  };
}


export function libraryView(db: Database): LibraryView {
  const view: LibraryView = { reading: [], queued: [], finished: [], abandoned: [] };
  for (const { card } of loadBooks(db)) view[card.status].push(card);
  view.reading.sort(byRecent);
  for (const group of [view.queued, view.finished, view.abandoned]) group.sort(byRecent);
  return view;
}

export function bookView(db: Database, itemId: string, today: LocalDate): BookView | null {
  const snapshot = loadBookSnapshot(db, itemId);
  if (!snapshot || snapshot.item.deletedAt !== null || snapshot.item.type !== 'book') return null;
  const live = eventOrder(snapshot.events);
  const events = [...live]
    .reverse()
    .map((e) => ({ id: e.id, type: e.type, page: e.page, localDate: e.localDate, occurredAt: e.occurredAt }));
  const card = toCard(snapshot.item, live, db.selectValue('SELECT 1 FROM covers WHERE item_id = ?', [itemId]) !== undefined);
  const pace = computePace({ itemId: snapshot.item.id, genre: snapshot.item.genre, totalPages: snapshot.item.totalPages, events: live }, today);
  const readThroughs = computeReadThroughs(live)
    .flatMap((rt) => (rt.outcome === 'finished' && rt.end !== null && rt.daysToFinish !== null ? [{ start: rt.start, end: rt.end, daysToFinish: rt.daysToFinish }] : []))
    .reverse();
  return { card, events, pace, readThroughs };
}

/** The non-removed book with this ISBN-13 (uses idx_items_isbn), or null. */
export function findByIsbn(db: Database, isbn: string): BookCard | null {
  const row = db.selectObject(`SELECT * FROM items WHERE isbn = ? AND type = 'book' AND deleted_at IS NULL LIMIT 1`, [isbn]);
  if (!row) return null;
  const item = rowToItem(row);
  const events = db
    .selectObjects('SELECT * FROM reading_events WHERE item_id = ? AND deleted_at IS NULL', [item.id])
    .map(rowToEvent);
  return toCard(item, events, db.selectValue('SELECT 1 FROM covers WHERE item_id = ?', [item.id]) !== undefined);
}

/** Books still waiting for catalog details (FR: retry when back online). */
export function pendingDetails(db: Database): { itemId: string; isbn: string }[] {
  return db
    .selectObjects(
      `SELECT id, isbn FROM items WHERE metadata_status = 'pending' AND isbn IS NOT NULL AND deleted_at IS NULL ORDER BY created_at`,
    )
    .map((r) => ({ itemId: text(r['id'], 'id'), isbn: text(r['isbn'], 'isbn') }));
}

/** Live books with a cover address and no cached cover: a synced book whose cover this device has not fetched yet (FR-016). */
export function missingCovers(db: Database): { itemId: string; coverUrl: string }[] {
  return db
    .selectObjects(
      `SELECT i.id, i.cover_url FROM items i
       WHERE i.type = 'book' AND i.deleted_at IS NULL AND i.cover_url IS NOT NULL AND i.cover_url <> ''
         AND NOT EXISTS (SELECT 1 FROM covers c WHERE c.item_id = i.id)
       ORDER BY i.created_at`,
    )
    .map((r) => ({ itemId: text(r['id'], 'id'), coverUrl: text(r['cover_url'], 'cover_url') }));
}

/** One side of a possible duplicate, for the review screen (worker-api-004.md). */
export interface DuplicateBookView {
  itemId: string;
  title: string;
  author: string | null;
  isbn: string | null;
  entryCount: number;
  createdAt: string;
}

/** `survivor` is the suggested book to keep: the smaller (createdAt, id), the same on every device. */
export interface DuplicatePairView {
  survivor: DuplicateBookView;
  duplicate: DuplicateBookView;
  reason: 'isbn' | 'titleAuthor';
}

/** Pairs of live books that look like the same book, minus the pairs the user chose to keep. */
export function duplicatePairs(db: Database): DuplicatePairView[] {
  const items = db.selectObjects(`SELECT * FROM items WHERE type = 'book' AND deleted_at IS NULL`).map(rowToItem);
  const dismissed = db
    .selectObjects('SELECT item_a, item_b FROM duplicate_dismissals WHERE deleted_at IS NULL')
    .map((r) => ({ itemA: text(r['item_a'], 'item_a'), itemB: text(r['item_b'], 'item_b') }));
  const counts = new Map<string, number>();
  for (const r of db.selectObjects(
    `SELECT item_id, COUNT(*) AS n FROM reading_events WHERE deleted_at IS NULL GROUP BY item_id`,
  )) counts.set(text(r['item_id'], 'item_id'), Number(r['n']));
  const byId = new Map(items.map((i) => [i.id as string, i]));
  const view = (id: string): DuplicateBookView => {
    const i = byId.get(id)!;
    return { itemId: i.id, title: i.title, author: i.author, isbn: i.isbn, entryCount: counts.get(i.id) ?? 0, createdAt: i.createdAt };
  };
  return findDuplicates(items, dismissed).map((p) => ({ survivor: view(p.survivor), duplicate: view(p.duplicate), reason: p.reason }));
}

/** Live entries on a book that was merged away: they belong on the final live book of its chain (research R8). */
export interface StragglerView {
  /** The removed book that still holds live entries. */
  duplicateId: string;
  /** The live book at the end of its `merged_into` chain. */
  survivorId: string;
  events: { id: string; type: EventType; page: number | null; occurredAt: string; localDate: string }[];
}

export function stragglers(db: Database): StragglerView[] {
  const out: StragglerView[] = [];
  const holders = db.selectValues(
    `SELECT i.id FROM items i
     WHERE i.merged_into IS NOT NULL AND i.deleted_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM reading_events e WHERE e.item_id = i.id AND e.deleted_at IS NULL)
     ORDER BY i.id`,
  ).map(String);
  for (const id of holders) {
    const chain = mergeChainIds(db, id);
    const survivorId = chain[chain.length - 1]!;
    if (survivorId === id) continue;
    if (db.selectValue('SELECT 1 FROM items WHERE id = ? AND deleted_at IS NULL', [survivorId]) === undefined) continue;
    const events = db
      .selectObjects('SELECT * FROM reading_events WHERE item_id = ? AND deleted_at IS NULL', [id])
      .map(rowToEvent)
      .map((e) => ({ id: e.id, type: e.type, page: e.page, occurredAt: e.occurredAt, localDate: e.localDate }));
    out.push({ duplicateId: id, survivorId, events });
  }
  return out;
}

/** An `items` row of type 'article' as the core `Article` (005 data-model). */
export function rowToArticle(r: Record<string, SqlValue>): Article {
  return {
    id: text(r['id'], 'id') as ItemId,
    title: text(r['title'], 'title') as NonEmptyTitle,
    author: textOrNull(r['author'], 'author') as Author | null,
    url: text(r['url'], 'url') as NormalizedUrl,
    domain: text(r['domain'], 'domain'),
    wordCount: intOrNull(r['word_count'], 'word_count') as WordCount | null,
    readOn: text(r['read_on'], 'read_on') as LocalDate,
    detailsStatus: detailsStatusFromDb(text(r['metadata_status'], 'metadata_status')),
    createdAt: text(r['created_at'], 'created_at') as Instant,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
  };
}

/** Read articles only (008 S-1): a saved article has no read date, and no stat, list or lookup of read articles may see it. */
const LIVE_ARTICLES = `FROM items WHERE type = 'article' AND deleted_at IS NULL AND read_on IS NOT NULL`;
const LIVE_SAVED = `FROM items WHERE type = 'article' AND deleted_at IS NULL AND read_on IS NULL`;
const NEWEST_FIRST = 'ORDER BY read_on DESC, created_at DESC, id';
/** Only the `Article` columns: copying whole rows across the WASM boundary dominates the cost (research R10b). */
const ARTICLE_COLS = 'id, title, author, url, domain, word_count, read_on, metadata_status, created_at, deleted_at';

/** The keyset cursor: the last row of the previous page. */
export interface ArticleCursor {
  readOn: string;
  createdAt: string;
  id: string;
}

export const ARTICLE_PAGE = 100;

/** An `ARTICLE_COLS` row (as an array) as the core `Article`. */
export function articleFromArray(r: readonly SqlValue[]): Article {
  return {
    id: text(r[0], 'id') as ItemId,
    title: text(r[1], 'title') as NonEmptyTitle,
    author: textOrNull(r[2], 'author') as Author | null,
    url: text(r[3], 'url') as NormalizedUrl,
    domain: text(r[4], 'domain'),
    wordCount: intOrNull(r[5], 'word_count') as WordCount | null,
    readOn: text(r[6], 'read_on') as LocalDate,
    detailsStatus: detailsStatusFromDb(text(r[7], 'metadata_status')),
    createdAt: text(r[8], 'created_at') as Instant,
    deletedAt: textOrNull(r[9], 'deleted_at') as Instant | null,
  };
}

/** Every live article with only the columns given, as arrays (stats need few of them). */
export function selectLiveArticleArrays(db: Database, cols: string): SqlValue[][] {
  return db.selectArrays(`SELECT ${cols} ${LIVE_ARTICLES}`);
}

/**
 * Live articles, newest read first, one keyset page at a time: `before` is the last row of the
 * previous page (research R10b). Order: read_on desc, created_at desc, id.
 */
export function articles(db: Database, opts: { limit?: number; before?: ArticleCursor } = {}): Article[] {
  const limit = Math.max(1, Math.floor(opts.limit ?? ARTICLE_PAGE));
  const b = opts.before;
  const after = b
    ? ' AND (read_on < ? OR (read_on = ? AND created_at < ?) OR (read_on = ? AND created_at = ? AND id > ?))'
    : '';
  const bind = b ? [b.readOn, b.readOn, b.createdAt, b.readOn, b.createdAt, b.id, limit] : [limit];
  return db.selectArrays(`SELECT ${ARTICLE_COLS} ${LIVE_ARTICLES}${after} ${NEWEST_FIRST} LIMIT ?`, bind).map(articleFromArray);
}

/** One live read article, or null (unknown, removed, a book, or saved: see `savedArticle`). */
export function article(db: Database, itemId: string): Article | null {
  const row = db.selectObject(`SELECT * ${LIVE_ARTICLES} AND id = ?`, [itemId]);
  return row ? rowToArticle(row) : null;
}

/** Live articles with this normalized address, newest first (FR-008). */
export function findArticleByUrl(db: Database, url: string): Article[] {
  return db.selectArrays(`SELECT ${ARTICLE_COLS} ${LIVE_ARTICLES} AND url = ? ${NEWEST_FIRST}`, [url]).map(articleFromArray);
}

/** Live highlights of a live item, oldest first (007 data-model). `[]` when the item is removed or unknown. */
export function highlightsView(db: Database, itemId: string): Highlight[] {
  return db
    .selectObjects(
      `SELECT h.* FROM highlights h JOIN items i ON i.id = h.item_id
       WHERE h.item_id = ? AND h.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY h.created_at, h.id`,
      [itemId],
    )
    .map(rowToHighlight);
}

/** A saved article (008): an article with no read date. Its saved date is `createdAt`. */
export type SavedArticle = Omit<Article, 'readOn'> & { readonly readOn: null };

const SAVED_COLS = 'id, title, author, url, domain, word_count, metadata_status, created_at, deleted_at';
const savedFromArray = (r: readonly SqlValue[]): SavedArticle => ({
  id: text(r[0], 'id') as ItemId,
  title: text(r[1], 'title') as NonEmptyTitle,
  author: textOrNull(r[2], 'author') as Author | null,
  url: text(r[3], 'url') as NormalizedUrl,
  domain: text(r[4], 'domain'),
  wordCount: intOrNull(r[5], 'word_count') as WordCount | null,
  readOn: null,
  detailsStatus: detailsStatusFromDb(text(r[6], 'metadata_status')),
  createdAt: text(r[7], 'created_at') as Instant,
  deletedAt: textOrNull(r[8], 'deleted_at') as Instant | null,
});

/** Live saved articles, newest saved first (created_at desc, then id); uses idx_items_saved. */
export function savedArticles(db: Database, opts: { limit?: number } = {}): SavedArticle[] {
  const limit = Math.max(1, Math.floor(opts.limit ?? Number.MAX_SAFE_INTEGER));
  return db.selectArrays(`SELECT ${SAVED_COLS} ${LIVE_SAVED} ORDER BY created_at DESC, id LIMIT ?`, [limit]).map(savedFromArray);
}

export function savedCount(db: Database): number {
  return Number(db.selectValue(`SELECT COUNT(*) ${LIVE_SAVED}`));
}

/** One live saved article, or null. */
export function savedArticle(db: Database, itemId: string): SavedArticle | null {
  const r = db.selectArrays(`SELECT ${SAVED_COLS} ${LIVE_SAVED} AND id = ?`, [itemId])[0];
  return r ? savedFromArray(r) : null;
}

/** Live saved articles with this normalized address, oldest first (the one a Mark as read should take). */
export function findSavedByUrl(db: Database, url: string): SavedArticle[] {
  return db.selectArrays(`SELECT ${SAVED_COLS} ${LIVE_SAVED} AND url = ? ORDER BY created_at, id`, [url]).map(savedFromArray);
}
