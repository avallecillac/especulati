import type { BookStatus, DetailsStatus, EventType } from '@readerlog/core';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { deriveStatus, eventOrder, lastActivity, lastPage, type Item, type ReadingEvent } from '@readerlog/core';
import { loadBookSnapshot, rowToEvent, rowToItem, text } from './snapshot.ts';

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

export function bookView(db: Database, itemId: string): BookView | null {
  const snapshot = loadBookSnapshot(db, itemId);
  if (!snapshot || snapshot.item.deletedAt !== null || snapshot.item.type !== 'book') return null;
  const live = eventOrder(snapshot.events);
  const events = [...live]
    .reverse()
    .map((e) => ({ id: e.id, type: e.type, page: e.page, localDate: e.localDate, occurredAt: e.occurredAt }));
  return { card: toCard(snapshot.item, live, db.selectValue('SELECT 1 FROM covers WHERE item_id = ?', [itemId]) !== undefined), events };
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
