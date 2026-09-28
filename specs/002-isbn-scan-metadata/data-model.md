# Data Model: ISBN Scan & Book Metadata Lookup (002)

This builds on [001 data-model.md](../001-local-book-log/data-model.md). The schema moves
to **v2**; the DDL is in
[contracts/db-and-worker-002.md](contracts/db-and-worker-002.md).

## Domain types (packages/core), added

| Type | Rule |
|---|---|
| `Isbn13` | 13 digits, prefix `978` or `979`, valid mod-10 check digit. ISBN-10 input is converted (research R6) |
| `DetailsStatus` | `complete` \| `pending` \| `notFound`, stored as `ok` \| `pending` \| `failed` |
| `CoverUrl` | `https://…`, at most 500 characters |

## Entities

### Item (book), fields now in use

| Field (column) | Type | Notes |
|---|---|---|
| `isbn` | Isbn13? | Normalized. Duplicate detection uses the partial index `idx_items_isbn` |
| `cover_url` | CoverUrl? | Where the cover came from. It syncs later (004) so other devices can re-fetch it |
| `metadata_status` | DetailsStatus | Default `ok` (complete). 001 books stay `ok` |
| `title` | NonEmptyTitle | May be the placeholder `ISBN <isbn13>` while pending |
| `cover_blob_key` | — | **Unused.** Superseded by the `covers` table, which is keyed by `item_id`. It stays NULL |

The rest is unchanged from 001.

### Stored Cover (`covers`, local cache only)

| Field | Notes |
|---|---|
| `item_id` | PK, FK → items |
| `mime` | always `image/jpeg` after normalization |
| `bytes` | at most 480 px tall, JPEG q0.75, about 25–35 KB |
| `width`, `height` | checked (40–2000 × 60–480) |
| `fetched_at` | Instant |

- It is not an event and not in `change_log`. It can always be rebuilt from `cover_url`.
- It is deleted by the worker after `RemoveBook`.

### Lookup Result (transient, UI memory only)

This is `BookDetails` in [contracts/catalog-lookup.md](contracts/catalog-lookup.md). It
becomes Book data only through `AddBook`, `EditBook` or `FillDetails`.

## Details status: transitions

```
                 AddBook(details found or typed)             ┌──────────┐
   (new) ────────────────────────────────────────────────▶  │ complete │
     │ AddBook(offline / unavailable / timeout)              └──────────┘
     ▼                                                         ▲    ▲
 ┌─────────┐  FillDetails(found)                               │    │ EditBook(detailsStatus: complete)
 │ pending │ ─────────────────────────────────────────────────┘    │ (US5: user applies fetched values)
 └─────────┘  FillDetails(notFound)        ┌──────────┐             │
     │  ───────────────────────────────▶  │ notFound │ ────────────┘
     │   EditBook(any user save → complete)└──────────┘
     └──────────────────────────────────────────────────▶ complete
```

- An `AddBook` done after the catalogs answered "not found" saves directly as
  `notFound`.
- Any explicit user save in the edit form marks the book `complete`. A background
  `FillDetails` then no longer applies (commands-002 invariant 7), so it can never
  overwrite a user edit.

## Validation rules, added

| Input | Rule | Rejection or behavior |
|---|---|---|
| isbn (AddBook, EditBook) | `parseIsbn` fails | `InvalidIsbn` |
| title blank + isbn present (AddBook) | — | the title becomes `ISBN <isbn13>` |
| coverUrl | not https, or over 500 characters | `InvalidInput { field: 'coverUrl' }` |
| catalog totalPages | not an integer 1..10000 | treated as missing (parser, not decide) |
| FillDetails detail value | fails its parser | the field is skipped, never a rejection |
| FillDetails totalPages | below the highest logged page | the field is skipped |
