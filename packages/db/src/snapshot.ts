import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import type {
  Author, BookSnapshot, EventId, EventType, Genre, Instant, Item, ItemId, ItemType, LocalDate,
  NonEmptyTitle, Page, PageCount, ReadingEvent,
} from '@readerlog/core';

// Rows were validated by decide() before they were written, and CHECK constraints guard
// the tables, so mapping them back to branded types is a trusted cast at this boundary.
// The converters still check the SQL storage class, so a schema mismatch fails loudly.
export function text(v: SqlValue | undefined, col: string): string {
  if (typeof v !== 'string') throw new TypeError(`column ${col}: expected TEXT, got ${typeof v}`);
  return v;
}
export const textOrNull = (v: SqlValue | undefined, col: string): string | null => (v === null || v === undefined ? null : text(v, col));
export function intOrNull(v: SqlValue | undefined, col: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number') throw new TypeError(`column ${col}: expected INTEGER, got ${typeof v}`);
  return v;
}

export function rowToItem(r: Record<string, SqlValue>): Item {
  return {
    id: text(r['id'], 'id') as ItemId,
    type: text(r['type'], 'type') as ItemType,
    title: text(r['title'], 'title') as NonEmptyTitle,
    author: textOrNull(r['author'], 'author') as Author | null,
    totalPages: intOrNull(r['total_pages'], 'total_pages') as PageCount | null,
    genre: textOrNull(r['genre'], 'genre') as Genre | null,
    createdAt: text(r['created_at'], 'created_at') as Instant,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
  };
}

export function rowToEvent(r: Record<string, SqlValue>): ReadingEvent {
  return {
    id: text(r['id'], 'id') as EventId,
    itemId: text(r['item_id'], 'item_id') as ItemId,
    type: text(r['event_type'], 'event_type') as EventType,
    page: intOrNull(r['page'], 'page') as Page | null,
    occurredAt: text(r['occurred_at'], 'occurred_at') as Instant,
    localDate: text(r['local_date'], 'local_date') as LocalDate,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
  };
}

/** Item plus all its events, including tombstoned ones; null if the id is unknown. */
export function loadBookSnapshot(db: Database, itemId: string): BookSnapshot | null {
  const row = db.selectObject('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!row) return null;
  const events = db.selectObjects('SELECT * FROM reading_events WHERE item_id = ?', [itemId]).map(rowToEvent);
  return { item: rowToItem(row), events };
}
