import type { BookStatus, DetailsStatus, EventType, Item, ReadingEvent } from './book.ts';
import type { Highlight } from './highlight.ts';
import type { Instant, ItemId } from './types.ts';

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
      /** 003 FR-022: the id of the `progress` entry an abandon at a page emits; only with `abandoned` and a page. */
      readonly pageEventId?: string;
    }
  | { readonly kind: 'RemoveEvent'; readonly itemId: string; readonly eventId: string }
  /** 004 R8. `copies` carries the shell's deterministic ids (core has no crypto). */
  | {
      readonly kind: 'MergeBooks';
      readonly survivorId: string;
      readonly duplicateId: string;
      readonly copies: readonly { readonly from: string; readonly to: string }[];
    }
  | { readonly kind: 'DismissDuplicate'; readonly dismissalId: string; readonly itemA: string; readonly itemB: string }
  /** 005 contracts/capture.md. `url` is raw input; decide() normalizes it. */
  | {
      readonly kind: 'AddArticle';
      readonly itemId: string;
      readonly url: string;
      readonly title: string;
      readonly author?: string | null;
      readonly wordCount?: number | null;
      /** 008: absent means a saved article (`read_on` is emitted explicitly as null). */
      readonly readOn?: string;
      readonly detailsStatus: 'complete' | 'notFound';
    }
  | {
      readonly kind: 'EditArticle';
      readonly itemId: string;
      readonly title?: string;
      readonly author?: string | null;
      readonly readOn?: string;
    }
  | { readonly kind: 'RemoveArticle'; readonly itemId: string }
  /** 007 contracts/commands-007.md. `quote` and `note` are raw input; decide() normalises them. */
  | {
      readonly kind: 'AddHighlight';
      readonly highlightId: string;
      readonly itemId: string;
      readonly quote?: string | null;
      readonly note?: string | null;
      readonly page?: number | null;
      readonly localDate: string;
    }
  /** An empty note clears it (rejected when the highlight has no quote). */
  | { readonly kind: 'EditHighlightNote'; readonly highlightId: string; readonly note: string }
  | { readonly kind: 'RemoveHighlight'; readonly highlightId: string }
  | { readonly kind: 'RestoreHighlight'; readonly highlightId: string }
  /** 008 contracts/commands-008.md. Needs a BookSnapshot of the article. Emits the full article row (S-2). */
  | { readonly kind: 'MarkArticleRead'; readonly itemId: string; readonly readOn: string }
  | { readonly kind: 'MarkArticleUnread'; readonly itemId: string }
  /** `tagId` and `itemTagId` are derived in the shell (research R3); `name` is raw input. */
  | { readonly kind: 'TagArticle'; readonly itemId: string; readonly tagId: string; readonly itemTagId: string; readonly name: string }
  | { readonly kind: 'UntagArticle'; readonly itemTagId: string }
  /** With `merge`, the rename folds this tag into `targetTagId`; `moves` must be the source's live assignments. */
  | {
      readonly kind: 'RenameTag';
      readonly tagId: string;
      readonly newName: string;
      readonly merge?: { readonly targetTagId: string; readonly moves: readonly TagMove[] };
    }
  | { readonly kind: 'DeleteTag'; readonly tagId: string }
  /** `copies` are highlight copies with content-addressed ids; `tagMoves` carry derived assignment ids on the survivor. */
  | {
      readonly kind: 'ReconcileSavedArticle';
      readonly survivorId: string;
      readonly duplicateId: string;
      readonly copies: readonly { readonly from: string; readonly to: string }[];
      readonly tagMoves: readonly TagMove[];
    };

/** Move one assignment: `from` (an item_tags id) is tombstoned; `to` (derived) is inserted or restored on `itemId`. */
export interface TagMove {
  readonly from: string;
  readonly to: string;
  readonly itemId: string;
}

export type Rejection =
  | { readonly kind: 'TitleRequired' }
  | { readonly kind: 'InvalidIsbn' }
  | { readonly kind: 'InvalidUrl' }
  | { readonly kind: 'InvalidPageCount' }
  | { readonly kind: 'InvalidPage' }
  | { readonly kind: 'PageBeyondEnd'; readonly totalPages: number }
  | { readonly kind: 'PageNotAllowed' }
  | { readonly kind: 'PagesBelowLogged'; readonly maxLogged: number }
  | { readonly kind: 'InvalidTransition'; readonly from: BookStatus; readonly type: EventType }
  | { readonly kind: 'NotFound' }
  | { readonly kind: 'AlreadyExists' }
  /** 008: MarkArticleRead on an article that already has a read date. */
  | { readonly kind: 'AlreadyRead' }
  /** 008: MarkArticleUnread on a saved article. */
  | { readonly kind: 'NotRead' }
  /** 008: the article already has `max` live tags. */
  | { readonly kind: 'TooManyTags'; readonly max: number }
  /** 007: a quote or note over 5,000 characters; never truncated. */
  | { readonly kind: 'TooLong'; readonly field: 'quote' | 'note'; readonly max: number }
  /** 007: a highlight needs a quote or a note. */
  | { readonly kind: 'HighlightEmpty' }
  /** Malformed ids, dates or over-long text: a programming or input error the UI can't normally produce. */
  | { readonly kind: 'InvalidInput'; readonly field: string; readonly reason: string };

export type Table = 'items' | 'reading_events' | 'duplicate_dismissals' | 'highlights' | 'tags' | 'item_tags';
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

/**
 * Snapshot for the highlight commands (007). `item` is the target item (`AddHighlight`: the item
 * named by `itemId`; null when absent). `highlight` is the row whose id the command names, live or
 * removed (null when absent): AddHighlight uses it for AlreadyExists; Edit, Remove and Restore need it.
 * Edit, Remove and Restore don't read `item`.
 */
export interface HighlightSnapshot {
  readonly item: { readonly id: ItemId; readonly type: 'book' | 'article'; readonly deletedAt: Instant | null } | null;
  readonly highlight: Highlight | null;
}

/** A `tags` row, live or removed (008 data-model). `nameKey` is `tagKey(name)`. */
export interface TagRow {
  readonly id: string;
  readonly name: string;
  readonly nameKey: string;
  readonly deletedAt: Instant | null;
}

/** An `item_tags` row, live or removed. */
export interface ItemTagRow {
  readonly id: string;
  readonly itemId: string;
  readonly tagId: string;
  readonly createdAt: Instant;
  readonly deletedAt: Instant | null;
}

/**
 * Snapshot for the tag commands (008). What the db layer must load, per command:
 * - `TagArticle`: `item` = the item named by `itemId` (null when absent); `tag` = the row with `tagId`
 *   (live or removed, null when absent); `assignments` = EVERY `item_tags` row of that item, live and
 *   removed (the row named by `itemTagId` and the live count come from it).
 * - `UntagArticle`: `assignments` includes the row with `itemTagId` (any state). Nothing else is read.
 * - `RenameTag`: `tag` = the source; `assignments` = every `item_tags` row of the source tag;
 *   with `merge`, `mergeTarget` = the row with `merge.targetTagId` and `targetAssignments` = every
 *   `item_tags` row of the target tag (live and removed).
 * - `DeleteTag`: `tag` = the tag; `assignments` = every `item_tags` row of the tag.
 * Unused fields are null / `[]`.
 */
export interface TagSnapshot {
  readonly item: { readonly id: ItemId; readonly type: 'book' | 'article'; readonly deletedAt: Instant | null } | null;
  readonly tag: TagRow | null;
  readonly mergeTarget: TagRow | null;
  readonly assignments: readonly ItemTagRow[];
  readonly targetAssignments: readonly ItemTagRow[];
}

/**
 * Snapshot for `ReconcileSavedArticle` (008). `survivor` and `duplicate` are the full item rows named by
 * the command (null when absent). `duplicateHighlights` = EVERY highlights row of the duplicate (live
 * and removed). `survivorHighlightIds` = the ids of every highlights row of the survivor (any state).
 * `duplicateAssignments` / `survivorAssignments` = EVERY `item_tags` row of each article (any state).
 */
export interface ReconcileSnapshot {
  readonly survivor: Item | null;
  readonly duplicate: Item | null;
  readonly duplicateHighlights: readonly Highlight[];
  readonly survivorHighlightIds: readonly string[];
  readonly duplicateAssignments: readonly ItemTagRow[];
  readonly survivorAssignments: readonly ItemTagRow[];
}
