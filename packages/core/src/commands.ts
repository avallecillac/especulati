import type { BookStatus, EventType, Item, ReadingEvent } from './book.ts';

/**
 * Commands carry raw user input plus shell-generated ids (constitution IV, v1.0.1):
 * decide() parses the input, so a command can be replayed idempotently.
 */
export type Command =
  | {
      readonly kind: 'AddBook';
      readonly itemId: string;
      readonly title: string;
      readonly author?: string | null;
      readonly totalPages?: number | null;
      readonly genre?: string | null;
      readonly startNow: boolean;
      readonly startEventId?: string;
      readonly localDate: string;
    }
  | {
      readonly kind: 'EditBook';
      readonly itemId: string;
      readonly title?: string;
      readonly author?: string | null;
      readonly totalPages?: number | null;
      readonly genre?: string | null;
    }
  | { readonly kind: 'RemoveBook'; readonly itemId: string }
  | {
      readonly kind: 'LogEvent';
      readonly itemId: string;
      readonly eventId: string;
      readonly type: EventType;
      readonly page?: number | null;
      readonly localDate: string;
    }
  | { readonly kind: 'RemoveEvent'; readonly itemId: string; readonly eventId: string };

export type Rejection =
  | { readonly kind: 'TitleRequired' }
  | { readonly kind: 'InvalidPageCount' }
  | { readonly kind: 'InvalidPage' }
  | { readonly kind: 'PageBeyondEnd'; readonly totalPages: number }
  | { readonly kind: 'PageNotAllowed' }
  | { readonly kind: 'PagesBelowLogged'; readonly maxLogged: number }
  | { readonly kind: 'InvalidTransition'; readonly from: BookStatus; readonly type: EventType }
  | { readonly kind: 'NotFound' }
  | { readonly kind: 'AlreadyExists' }
  /** Malformed ids, dates or over-long text: a programming or input error the UI can't normally produce. */
  | { readonly kind: 'InvalidInput'; readonly field: string; readonly reason: string };

export type Table = 'items' | 'reading_events';
export type FieldValue = string | number | null;

/** One row upsert: only the fields being set. Column names are DB columns. */
export interface Change {
  readonly tbl: Table;
  readonly rowId: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

export interface Decision {
  readonly changes: readonly Change[];
  /** True when a progress page equals total_pages (FR-007). */
  readonly offerFinish: boolean;
}

export interface BookSnapshot {
  readonly item: Item;
  /** All events of the item, including tombstoned ones. */
  readonly events: readonly ReadingEvent[];
}
