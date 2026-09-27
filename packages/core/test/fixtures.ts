import type { DeviceId, EventId, Instant, ItemId, LocalDate } from '../src/index.ts';

/** Deterministic lowercase v4-shaped UUIDs: uuid(1) → 00000000-0000-4000-8000-000000000001 */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const itemId = (n: number) => uuid(n) as ItemId;
export const eventId = (n: number) => uuid(1000 + n) as EventId;
export const deviceId = (n = 1) => uuid(9000 + n) as DeviceId;
export const instant = (s: string) => s as Instant;
export const day = (s: string) => s as LocalDate;

import type { BookSnapshot, Item, ReadingEvent, Change } from '../src/index.ts';

export const NOW = instant('2026-09-27T12:00:00.000Z');

export function book(p: Partial<Item> = {}): Item {
  return {
    id: itemId(1),
    type: 'book',
    title: 'Dune' as Item['title'],
    author: null,
    totalPages: 300 as Item['totalPages'],
    genre: null,
    createdAt: instant('2026-09-01T10:00:00.000Z'),
    deletedAt: null,
    ...p,
  };
}

let evSeq = 500;
export function event(p: Partial<ReadingEvent> & Pick<ReadingEvent, 'type'>): ReadingEvent {
  return {
    id: eventId(++evSeq),
    itemId: itemId(1),
    page: null,
    occurredAt: instant('2026-09-01T10:00:00.000Z'),
    localDate: day('2026-09-01'),
    deletedAt: null,
    ...p,
  };
}

export const snap = (item: Item, events: ReadingEvent[] = []): BookSnapshot => ({ item, events });

/** Apply decided changes to a snapshot in memory (mirrors the DB apply for tests). */
export function applyToSnapshot(s: BookSnapshot | null, changes: readonly Change[]): BookSnapshot | null {
  let cur = s;
  for (const c of changes) {
    if (c.tbl === 'items') {
      const f = c.fields;
      const base: Item = cur?.item ?? book({ id: c.rowId as Item['id'] });
      const item: Item = {
        ...base,
        ...('type' in f ? { type: f['type'] as Item['type'] } : {}),
        ...('title' in f ? { title: f['title'] as Item['title'] } : {}),
        ...('author' in f ? { author: f['author'] as Item['author'] } : {}),
        ...('total_pages' in f ? { totalPages: f['total_pages'] as Item['totalPages'] } : {}),
        ...('genre' in f ? { genre: f['genre'] as Item['genre'] } : {}),
        ...('created_at' in f ? { createdAt: f['created_at'] as Item['createdAt'] } : {}),
        ...('deleted_at' in f ? { deletedAt: f['deleted_at'] as Item['deletedAt'] } : {}),
      };
      cur = { item, events: cur?.events ?? [] };
    } else {
      if (!cur) throw new Error('event before item');
      const f = c.fields;
      const existing = cur.events.find((e) => e.id === c.rowId);
      const ev: ReadingEvent = existing
        ? { ...existing, ...('deleted_at' in f ? { deletedAt: f['deleted_at'] as ReadingEvent['deletedAt'] } : {}) }
        : {
            id: c.rowId as ReadingEvent['id'],
            itemId: f['item_id'] as ReadingEvent['itemId'],
            type: f['event_type'] as ReadingEvent['type'],
            page: (f['page'] ?? null) as ReadingEvent['page'],
            occurredAt: f['occurred_at'] as ReadingEvent['occurredAt'],
            localDate: f['local_date'] as ReadingEvent['localDate'],
            deletedAt: null,
          };
      cur = { item: cur.item, events: existing ? cur.events.map((e) => (e.id === ev.id ? ev : e)) : [...cur.events, ev] };
    }
  }
  return cur;
}
