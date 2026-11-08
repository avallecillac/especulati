# Data Model: Save for Later, Tags and Search (008)

## Migration 5

```sql
-- Tags (008). The v1 tables were never written (verified), so they are rebuilt with
-- row ids for sync.
DROP TABLE item_tags;
DROP TABLE tags;
CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key   TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_tags_key ON tags(name_key) WHERE deleted_at IS NULL;
CREATE TABLE item_tags (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id),
  tag_id     TEXT NOT NULL REFERENCES tags(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_item_tags_item ON item_tags(item_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_item_tags_tag  ON item_tags(tag_id)  WHERE deleted_at IS NULL;

-- Saved articles (read_on IS NULL) list newest first.
CREATE INDEX idx_items_saved ON items(created_at) WHERE type = 'article' AND read_on IS NULL AND deleted_at IS NULL;

-- Re-read once, so batches skipped before this version are applied (R2, as in migration 4).
UPDATE meta SET value = '0' WHERE key = 'sync_cursor';
UPDATE meta SET value = json_set(value, '$.undecryptable', 0) WHERE key = 'sync_status' AND json_valid(value);
```

## Sync allow-lists (`packages/core/src/merge.ts`)

| | |
|---|---|
| `Table` | gains `'tags'` and `'item_tags'` |
| `WRITABLE_FIELDS.tags` | `name`, `name_key`, `created_at`, `deleted_at` |
| `WRITABLE_FIELDS.item_tags` | `item_id`, `tag_id`, `created_at`, `deleted_at` |
| `INSERT_FIELDS.tags` | `name`, `name_key`, `created_at` |
| `INSERT_FIELDS.item_tags` | `item_id`, `tag_id`, `created_at` |
| `canInsert` | parks `item_tags` until both its item and its tag exist |
| `tierOf(tbl, fields)` | `h` for `highlights`; `t` for `tags` and `item_tags`; `s` for an `items` op whose fields contain `read_on: null`; `base` otherwise (R2) |

## Invariants

- **S-1.** No statistic, read-article list or "Already logged" lookup includes an
  article with `read_on IS NULL`.
- **S-2.** `MarkArticleRead` emits every article insert field. Applied on a peer with no
  row, it yields a complete read article.
- **T-1.** At most 20 live tags per article. `name_key` is unique among live tags as
  seen in lists, which group by key.
- **T-2.** Concurrent creation of the same name on two peers converges to one tag id.
- **R-1.** Reconcile is deterministic: two peers reconciling the same pair produce
  identical changes.
- **C-1.** A 0.8.0 peer never holds an article with `read_on NULL`, and never fails to
  read its own DB.
