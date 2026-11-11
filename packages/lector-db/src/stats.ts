import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { articleStats, computeStats, type ArticleStatInput, type ArticleStats, type WordCount, type Genre, type ItemId, type LocalDate, type PageCount, type EventId, type EventType, type Instant, type Page, type ReadingEvent, type StatsBook, type StatsView } from '@especulati/lector-core';
import { selectLiveArticleArrays } from './queries.ts';
import { intOrNull, text, textOrNull } from './snapshot.ts';

/**
 * Every non-removed book with its non-removed events, from ONE query (research R1, R8, R10).
 * A book with no live events gets `events: []` (json_group_array over no rows gives `[]`).
 * Articles are excluded here, at the data boundary (FR-005).
 */
export function loadStatsBooks(db: Database): StatsBook[] {
  // One row per book, its events packed into JSON by SQLite: copying ~10,000 event rows across
  // the WASM boundary dominated the stats time (research R8; the same cause as 005 R10b).
  const rows = db.selectArrays(
    `SELECT i.id, i.genre, i.total_pages,
       (SELECT json_group_array(json_array(e.id, e.event_type, e.page, e.occurred_at, e.local_date))
        FROM reading_events e WHERE e.item_id = i.id AND e.deleted_at IS NULL)
     FROM items i
     WHERE i.type = 'book' AND i.deleted_at IS NULL
     ORDER BY i.created_at, i.id`,
  );
  return rows.map((r): StatsBook => {
    const id = text(r[0], 'book_id') as ItemId;
    const packed = JSON.parse(text(r[3], 'events')) as SqlValue[][];
    return {
      itemId: id,
      genre: textOrNull(r[1], 'genre') as Genre | null,
      totalPages: intOrNull(r[2], 'total_pages') as PageCount | null,
      events: packed.map(
        (e): ReadingEvent => ({
          id: text(e[0], 'id') as EventId,
          itemId: id,
          type: text(e[1], 'event_type') as EventType,
          page: intOrNull(e[2], 'page') as Page | null,
          occurredAt: text(e[3], 'occurred_at') as Instant,
          localDate: text(e[4], 'local_date') as LocalDate,
          deletedAt: null,
        }),
      ),
    };
  });
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
