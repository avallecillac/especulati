# Data Model: Highlights and Notes (007)

## Migration 4 (`packages/db/src/migrations.ts`)

```sql
-- Synced (007). One row per highlight or note. Removal is a tombstone.
CREATE TABLE highlights (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id),
  quote      TEXT CHECK (quote IS NULL OR length(quote) BETWEEN 1 AND 5000),
  note       TEXT CHECK (note  IS NULL OR length(note)  BETWEEN 1 AND 5000),
  page       INTEGER CHECK (page IS NULL OR page > 0),
  created_at TEXT NOT NULL,
  local_date TEXT NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  deleted_at TEXT,
  CHECK (quote IS NOT NULL OR note IS NOT NULL)
);
CREATE INDEX idx_highlights_item ON highlights(item_id, created_at) WHERE deleted_at IS NULL;

-- Re-read the whole space once, so batches skipped before this version are applied (R2).
UPDATE meta SET value = '0' WHERE key = 'sync_cursor';
```

- **`SCHEMA_VERSION`:** becomes 4.
- **Migration test:** a v3 fixture DB with a sync cursor migrates to v4. It keeps all
  rows, has the `highlights` table, and its cursor is 0.

## Sync allow-lists (`packages/core/src/merge.ts`)

- **`Table`:** gains `'highlights'`.
- **`WRITABLE_FIELDS.highlights`:** `item_id`, `quote`, `note`, `page`, `created_at`,
  `local_date`, `deleted_at`.
- **`INSERT_FIELDS.highlights`:** `item_id`, `created_at`, `local_date`.
- **`canInsert` in `packages/db/src/sync.ts`:** a highlight whose item hasn't arrived
  yet is parked, the same rule as `reading_events`.

## Core types (`packages/core/src/highlight.ts`)

```ts
interface Highlight { id: HighlightId; itemId: ItemId; quote: string | null; note: string | null;
                      page: number | null; createdAt: Instant; localDate: LocalDate; deletedAt: Instant | null }
const QUOTE_MAX = 5000, NOTE_MAX = 5000;
```

## Read model (`packages/db/src/queries.ts`)

- **`highlights(itemId)`:** returns `Highlight[]`, live rows only, ordered by
  `created_at, id`. It returns `[]` when the item is removed.
- **`ArticleView`:** gains `highlightCount`, used for the Articles list badge later. It
  is optional, not required by the spec.

## Invariants

- **H-1.** Highlights never affect `stats`, `articleStats`, `home` or `library` output
  (FR-014). Checked deep-equal before and after adding 100 highlights.
- **H-2.** Two peers adding highlights to the same article at once both keep both
  (convergence test).
- **H-3.** An item's removal hides its highlights. Restoring the item (by sync) shows
  them again; the rows are never deleted.
