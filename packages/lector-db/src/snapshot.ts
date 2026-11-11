import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { detailsStatusFromDb } from '@especulati/lector-core';
import type {
  ItemTagRow, ReconcileSnapshot, TagRow, TagSnapshot,
  Author, Highlight, HighlightId, HighlightSnapshot, BookSnapshot, BooksSnapshot, CoverUrl, Isbn13, EventId, EventType, Genre, Instant, Item, ItemId, ItemType, LocalDate,
  NonEmptyTitle, NormalizedUrl, Page, PageCount, ReadingEvent,
} from '@especulati/lector-core';

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
    isbn: textOrNull(r['isbn'], 'isbn') as Isbn13 | null,
    coverUrl: textOrNull(r['cover_url'], 'cover_url') as CoverUrl | null,
    detailsStatus: detailsStatusFromDb(text(r['metadata_status'], 'metadata_status')),
    createdAt: text(r['created_at'], 'created_at') as Instant,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
    mergedInto: textOrNull(r['merged_into'], 'merged_into') as ItemId | null,
    url: textOrNull(r['url'], 'url') as NormalizedUrl | null,
    domain: textOrNull(r['domain'], 'domain'),
    wordCount: intOrNull(r['word_count'], 'word_count'),
    readOn: textOrNull(r['read_on'], 'read_on') as LocalDate | null,
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

/**
 * Snapshot for the multi-book commands: every known book of `ids` with its events, plus the live
 * dismissals among them. Unknown ids are skipped; decide() answers NotFound.
 */
export function loadBooksSnapshot(db: Database, ids: readonly string[]): BooksSnapshot {
  const unique = [...new Set(ids)];
  const books = unique.map((id) => loadBookSnapshot(db, id)).filter((b): b is BookSnapshot => b !== null);
  const dismissals = unique.length === 0 ? [] : db
    .selectObjects(`SELECT id, deleted_at FROM duplicate_dismissals WHERE item_a IN (${unique.map(() => '?').join(',')}) AND item_b IN (${unique.map(() => '?').join(',')})`, [...unique, ...unique])
    .map((r) => ({ id: text(r['id'], 'id'), deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null }));
  return { books, dismissals };
}

/** `id` followed by every book on its `merged_into` chain (cycle-safe), for validating a sweep. */
export function mergeChainIds(db: Database, id: string): string[] {
  const out = [id];
  let cur: string | null = id;
  while (cur !== null) {
    const next: SqlValue | undefined = db.selectValue('SELECT merged_into FROM items WHERE id = ?', [cur]);
    cur = typeof next === 'string' && !out.includes(next) ? next : null;
    if (cur !== null) out.push(cur);
  }
  return out;
}

export function rowToHighlight(r: Record<string, SqlValue>): Highlight {
  return {
    id: text(r['id'], 'id') as HighlightId,
    itemId: text(r['item_id'], 'item_id') as ItemId,
    quote: textOrNull(r['quote'], 'quote'),
    note: textOrNull(r['note'], 'note'),
    page: intOrNull(r['page'], 'page'),
    createdAt: text(r['created_at'], 'created_at') as Instant,
    localDate: text(r['local_date'], 'local_date') as LocalDate,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
  };
}

/** The highlights row with this id, tombstoned or not; null if unknown. */
export function loadHighlight(db: Database, id: string): Highlight | null {
  const r = db.selectObject('SELECT * FROM highlights WHERE id = ?', [id]);
  return r ? rowToHighlight(r) : null;
}

/** Snapshot for the highlight commands: the target item (AddHighlight only) and the named highlight. */
export function loadHighlightSnapshot(db: Database, highlightId: string, itemId: string | null): HighlightSnapshot {
  const row = itemId === null ? undefined : db.selectObject('SELECT id, type, deleted_at FROM items WHERE id = ?', [itemId]);
  return {
    item: row
      ? { id: text(row['id'], 'id') as ItemId, type: text(row['type'], 'type') as 'book' | 'article', deletedAt: textOrNull(row['deleted_at'], 'deleted_at') as Instant | null }
      : null,
    highlight: loadHighlight(db, highlightId),
  };
}

function rowToTag(r: Record<string, SqlValue>): TagRow {
  return { id: text(r['id'], 'id'), name: text(r['name'], 'name'), nameKey: text(r['name_key'], 'name_key'), deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null };
}

function rowToItemTag(r: Record<string, SqlValue>): ItemTagRow {
  return {
    id: text(r['id'], 'id'),
    itemId: text(r['item_id'], 'item_id'),
    tagId: text(r['tag_id'], 'tag_id'),
    createdAt: text(r['created_at'], 'created_at') as Instant,
    deletedAt: textOrNull(r['deleted_at'], 'deleted_at') as Instant | null,
  };
}

const loadTag = (db: Database, id: string | null): TagRow | null => {
  const r = id === null ? undefined : db.selectObject('SELECT * FROM tags WHERE id = ?', [id]);
  return r ? rowToTag(r) : null;
};
const itemTagsOfItem = (db: Database, itemId: string): ItemTagRow[] =>
  db.selectObjects('SELECT * FROM item_tags WHERE item_id = ? ORDER BY id', [itemId]).map(rowToItemTag);
const itemTagsOfTag = (db: Database, tagId: string): ItemTagRow[] =>
  db.selectObjects('SELECT * FROM item_tags WHERE tag_id = ? ORDER BY id', [tagId]).map(rowToItemTag);

type TagCommand =
  | { kind: 'TagArticle'; itemId: string; tagId: string; itemTagId: string }
  | { kind: 'UntagArticle'; itemTagId: string }
  | { kind: 'RenameTag'; tagId: string; merge?: { targetTagId: string } | undefined }
  | { kind: 'DeleteTag'; tagId: string };

/** Snapshot for the tag commands, as documented on `TagSnapshot` in core. Unused fields are null / []. */
export function loadTagSnapshot(db: Database, cmd: TagCommand): TagSnapshot {
  const empty: TagSnapshot = { item: null, tag: null, mergeTarget: null, assignments: [], targetAssignments: [] };
  switch (cmd.kind) {
    case 'TagArticle': {
      const row = db.selectObject('SELECT id, type, deleted_at FROM items WHERE id = ?', [cmd.itemId]);
      return {
        ...empty,
        item: row ? { id: text(row['id'], 'id') as ItemId, type: text(row['type'], 'type') as 'book' | 'article', deletedAt: textOrNull(row['deleted_at'], 'deleted_at') as Instant | null } : null,
        tag: loadTag(db, cmd.tagId),
        assignments: itemTagsOfItem(db, cmd.itemId),
      };
    }
    case 'UntagArticle': {
      const r = db.selectObject('SELECT * FROM item_tags WHERE id = ?', [cmd.itemTagId]);
      return { ...empty, assignments: r ? [rowToItemTag(r)] : [] };
    }
    case 'RenameTag':
      return {
        ...empty,
        tag: loadTag(db, cmd.tagId),
        assignments: itemTagsOfTag(db, cmd.tagId),
        ...(cmd.merge ? { mergeTarget: loadTag(db, cmd.merge.targetTagId), targetAssignments: itemTagsOfTag(db, cmd.merge.targetTagId) } : {}),
      };
    case 'DeleteTag':
      return { ...empty, tag: loadTag(db, cmd.tagId), assignments: itemTagsOfTag(db, cmd.tagId) };
  }
}

/** Snapshot for `ReconcileSavedArticle`, as documented on `ReconcileSnapshot` in core. */
export function loadReconcileSnapshot(db: Database, survivorId: string, duplicateId: string): ReconcileSnapshot {
  const item = (id: string): Item | null => {
    const r = db.selectObject('SELECT * FROM items WHERE id = ?', [id]);
    return r ? rowToItem(r) : null;
  };
  return {
    survivor: item(survivorId),
    duplicate: item(duplicateId),
    duplicateHighlights: db.selectObjects('SELECT * FROM highlights WHERE item_id = ? ORDER BY id', [duplicateId]).map(rowToHighlight),
    survivorHighlightIds: db.selectValues('SELECT id FROM highlights WHERE item_id = ? ORDER BY id', [survivorId]).map(String),
    duplicateAssignments: itemTagsOfItem(db, duplicateId),
    survivorAssignments: itemTagsOfItem(db, survivorId),
  };
}
