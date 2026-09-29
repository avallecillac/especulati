import type { BookStatus, DetailsStatus, EventType, Item, ReadingEvent } from './book.ts';
import type { Instant } from './types.ts';

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
      readonly isbn?: string | null;
      readonly coverUrl?: string | null;
      readonly detailsStatus?: DetailsStatus;
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
      readonly isbn?: string | null;
      readonly coverUrl?: string | null;
      readonly detailsStatus?: DetailsStatus;
    }
  | { readonly kind: 'RemoveBook'; readonly itemId: string }
  | {
      readonly kind: 'FillDetails';
      readonly itemId: string;
      readonly outcome: 'found' | 'notFound';
      readonly details?: {
        readonly title?: string;
        readonly author?: string | null;
        readonly totalPages?: number | null;
        readonly genre?: string | null;
        readonly coverUrl?: string | null;
      };
    }
  | {
      readonly kind: 'LogEvent';
      readonly itemId: string;
      readonly eventId: string;
      readonly type: EventType;
      readonly page?: number | null;
      readonly localDate: string;
    }
  | { readonly kind: 'RemoveEvent'; readonly itemId: string; readonly eventId: string }
  /** 004 R8. `copies` carries the shell's deterministic ids (core has no crypto). */
  | {
      readonly kind: 'MergeBooks';
      readonly survivorId: string;
      readonly duplicateId: string;
      readonly copies: readonly { readonly from: string; readonly to: string }[];
    }
  | { readonly kind: 'DismissDuplicate'; readonly dismissalId: string; readonly itemA: string; readonly itemB: string };

export type Rejection =
  | { readonly kind: 'TitleRequired' }
  | { readonly kind: 'InvalidIsbn' }
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

export type Table = 'items' | 'reading_events' | 'duplicate_dismissals';
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

/**
 * Snapshot for the multi-book commands (contracts/commands-004.md). For a sweep merge it also
 * holds the books on the duplicate's `merged_into` chain, so decide() can verify the chain.
 */
export interface BooksSnapshot {
  readonly books: readonly BookSnapshot[];
  /** Dismissals among these books, for DismissDuplicate idempotence. */
  readonly dismissals?: readonly { readonly id: string; readonly deletedAt: Instant | null }[];
}
