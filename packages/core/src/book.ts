import type { Author, CoverUrl, EventId, Genre, Isbn13, Instant, ItemId, LocalDate, NonEmptyTitle, Page, PageCount } from './types.ts';

export type ItemType = 'book' | 'article';
export type EventType = 'started' | 'progress' | 'finished' | 'abandoned';
export type BookStatus = 'queued' | 'reading' | 'finished' | 'abandoned';

export type DetailsStatus = 'complete' | 'pending' | 'notFound';
export type DetailsStatusDb = 'ok' | 'pending' | 'failed';

const TO_DB: Record<DetailsStatus, DetailsStatusDb> = { complete: 'ok', pending: 'pending', notFound: 'failed' };

export const detailsStatusToDb = (s: DetailsStatus): DetailsStatusDb => TO_DB[s];

export function detailsStatusFromDb(s: string): DetailsStatus {
  switch (s) {
    case 'ok': return 'complete';
    case 'pending': return 'pending';
    case 'failed': return 'notFound';
    default: throw new Error(`unknown metadata_status: ${s}`);
  }
}

export interface Item {
  readonly id: ItemId;
  readonly type: ItemType;
  readonly title: NonEmptyTitle;
  readonly author: Author | null;
  readonly totalPages: PageCount | null;
  readonly genre: Genre | null;
  readonly isbn: Isbn13 | null;
  readonly coverUrl: CoverUrl | null;
  readonly detailsStatus: DetailsStatus;
  readonly createdAt: Instant;
  readonly deletedAt: Instant | null;
}

export interface ReadingEvent {
  readonly id: EventId;
  readonly itemId: ItemId;
  readonly type: EventType;
  /** Only on `progress`; null = "read today" without a page. */
  readonly page: Page | null;
  readonly occurredAt: Instant;
  readonly localDate: LocalDate;
  readonly deletedAt: Instant | null;
}

/** Non-deleted events in (local_date, occurred_at, id) order — the single ordering all derivations use. */
export function eventOrder(events: readonly ReadingEvent[]): ReadingEvent[] {
  return events
    .filter((e) => e.deletedAt === null)
    .sort((a, b) =>
      a.localDate !== b.localDate ? (a.localDate < b.localDate ? -1 : 1)
      : a.occurredAt !== b.occurredAt ? (a.occurredAt < b.occurredAt ? -1 : 1)
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
}

const STATUS_BY_EVENT: Record<EventType, BookStatus> = {
  started: 'reading',
  progress: 'reading',
  finished: 'finished',
  abandoned: 'abandoned',
};

/** Status is derived from the latest non-deleted event, never stored (constitution III). */
export function deriveStatus(events: readonly ReadingEvent[]): BookStatus {
  const last = eventOrder(events).at(-1);
  return last ? STATUS_BY_EVENT[last.type] : 'queued';
}

export function lastPage(events: readonly ReadingEvent[]): Page | null {
  const ordered = eventOrder(events);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const page = ordered[i]!.page;
    if (page !== null) return page;
  }
  return null;
}

/** Highest page ever logged (non-deleted), used to keep total_pages consistent. */
export function maxLoggedPage(events: readonly ReadingEvent[]): Page | null {
  let max: Page | null = null;
  for (const e of eventOrder(events)) if (e.page !== null && (max === null || e.page > max)) max = e.page;
  return max;
}

export interface Activity {
  readonly localDate: LocalDate;
  readonly occurredAt: Instant;
}

export function lastActivity(events: readonly ReadingEvent[]): Activity | null {
  const last = eventOrder(events).at(-1);
  return last ? { localDate: last.localDate, occurredAt: last.occurredAt } : null;
}
