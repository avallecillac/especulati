import type { BookStatus, EventType } from '@readerlog/core';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { deriveStatus, eventOrder, lastActivity, lastPage, type ReadingEvent } from '@readerlog/core';
import { rowToEvent, rowToItem } from './snapshot.ts';

/** Read models returned to the UI (contracts/worker-api.md). Plain JSON: nulls, no brands. */
export interface BookCard {
  itemId: string;
  title: string;
  author: string | null;
  totalPages: number | null;
  genre: string | null;
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


/** All non-deleted books with their events: two queries, grouped in memory (≈100 books/decade). */
function loadBooks(db: Database): { card: BookCard; events: ReadingEvent[] }[] {
  const items = db.selectObjects(`SELECT * FROM items WHERE type = 'book' AND deleted_at IS NULL`).map(rowToItem);
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
    return {
      events,
      card: {
        itemId: item.id,
        title: item.title,
        author: item.author,
        totalPages: item.totalPages,
        genre: item.genre,
        status: deriveStatus(events),
        lastPage: lastPage(events),
        lastActivity: lastActivity(events),
      },
    };
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
  const found = loadBooks(db).find((b) => b.card.itemId === itemId);
  if (!found) return null;
  const events = eventOrder(found.events)
    .reverse()
    .map((e) => ({ id: e.id, type: e.type, page: e.page, localDate: e.localDate, occurredAt: e.occurredAt }));
  return { card: found.card, events };
}
