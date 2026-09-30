import type { Database } from '@sqlite.org/sqlite-wasm';
import { articleStats, computeStats, type ArticleStatInput, type ArticleStats, type WordCount, type Genre, type ItemId, type LocalDate, type PageCount, type ReadingEvent, type StatsBook, type StatsView } from '@readerlog/core';
import { selectLiveArticleArrays } from './queries.ts';
import { intOrNull, rowToEvent, text, textOrNull } from './snapshot.ts';

/**
 * Every non-removed book with its non-removed events, from ONE query (research R1, R8, R10).
 * A LEFT JOIN keeps books that have no events; the `e.deleted_at` filter sits in the ON
 * clause so a book whose events are all removed still appears with `events: []`.
 * Articles are excluded here, at the data boundary (FR-005).
 */
export function loadStatsBooks(db: Database): StatsBook[] {
  const rows = db.selectObjects(
    `SELECT i.id AS book_id, i.genre AS book_genre, i.total_pages AS book_total_pages,
            e.id, e.item_id, e.event_type, e.page, e.occurred_at, e.local_date, e.deleted_at
     FROM items i
     LEFT JOIN reading_events e ON e.item_id = i.id AND e.deleted_at IS NULL
     WHERE i.type = 'book' AND i.deleted_at IS NULL
     ORDER BY i.created_at, i.id`,
  );
  const books = new Map<string, { itemId: ItemId; genre: Genre | null; totalPages: PageCount | null; events: ReadingEvent[] }>();
  for (const r of rows) {
    const id = text(r['book_id'], 'book_id');
    let b = books.get(id);
    if (!b) {
      b = {
        itemId: id as ItemId,
        genre: textOrNull(r['book_genre'], 'genre') as Genre | null,
        totalPages: intOrNull(r['book_total_pages'], 'total_pages') as PageCount | null,
        events: [],
      };
      books.set(id, b);
    }
    if (r['id'] !== null) b.events.push(rowToEvent(r));
  }
  return [...books.values()];
}

/** The Stats screen's data: all books from one query, then pure maths in core. */
export function statsView(db: Database, year: number, today: LocalDate): StatsView {
  return computeStats(loadStatsBooks(db), { year, today });
}

/**
 * Every live article, with only the columns `articleStats` reads (research R10b). Separate from
 * `loadStatsBooks`: articles never reach the book stats (FR-005).
 */
export function loadArticles(db: Database): ArticleStatInput[] {
  return selectLiveArticleArrays(db, 'domain, word_count, read_on').map(
    (r): ArticleStatInput => ({
      domain: text(r[0], 'domain'),
      wordCount: intOrNull(r[1], 'word_count') as WordCount | null,
      readOn: text(r[2], 'read_on') as LocalDate,
      deletedAt: null,
    }),
  );
}

/** The Stats screen's Articles section: one query, then pure maths in core. */
export function articleStatsView(db: Database, year: number, today: LocalDate): ArticleStats {
  return articleStats(loadArticles(db), { year, today });
}
