# Data Model: Local Book Log (001)

Only `schema_version` 1 exists. Migrations are keyed on `PRAGMA user_version`. The
full DDL is in [contracts/db-schema.md](contracts/db-schema.md).

## Domain types (packages/core)

These are branded types. Each is constructed only by its parser, and each parser
returns `Result<T, ValidationError>`.

| Type | Rule |
|---|---|
| `ItemId`, `EventId`, `DeviceId` | Lowercase UUID string |
| `NonEmptyTitle` | Trimmed, 1–500 characters |
| `Author`, `Genre` | Trimmed, 1–200 characters; empty input → `null` |
| `PageCount` | Integer, 1–100 000 |
| `Page` | Integer, 1–100 000. Also ≤ `total_pages` when that is known |
| `LocalDate` | `YYYY-MM-DD`, a real calendar date |
| `Instant` | UTC ISO-8601 with `Z` |
| `Hlc` | `^\d{13}-\d{4}-<uuid>$`. Compared lexicographically |

## Entities

Spec terms map to model terms as follows: *Reading Entry* = `ReadingEvent`,
*Change Record* = a `change_log` row, *Device Identity* = `meta.device_id`.


### Item (`items`), book subset for 001

| Field | Type | Notes |
|---|---|---|
| id | ItemId | PK |
| type | `'book'` | `'article'` is reserved for 005 |
| title | NonEmptyTitle | required |
| author | Author? | |
| total_pages | PageCount? | |
| genre | Genre? | |
| created_at | Instant | set once |
| deleted_at | Instant? | tombstone. Hides the book and all its events |

The columns for 002, 005, and later features (`isbn`, `cover_url`, `cover_blob_key`,
`url`, `domain`, `word_count`, `read_on`, `metadata_status`, `rating`) exist in
migration 1. They stay NULL or default in this feature, so later features need no
migration.

### ReadingEvent (`reading_events`)

| Field | Type | Notes |
|---|---|---|
| id | EventId | PK |
| item_id | ItemId | FK to items |
| event_type | `started` \| `progress` \| `finished` \| `abandoned` | |
| page | Page? | Only for `progress`. NULL means "read today" |
| occurred_at | Instant | when it was recorded |
| local_date | LocalDate | the day the user experienced. Explicit, never derived |
| deleted_at | Instant? | tombstone. The only field that may change after insert |

### Sync bookkeeping (written in 001, consumed in 004)

- **field_clock** `(tbl, row_id, field) → hlc`: the latest HLC that set each field.
- **change_log** `(seq, op_id, hlc, device_id, tbl, row_id, fields_json, pushed)`:
  one row per applied change.
- **meta**: `device_id` (created on first run), `hlc` (the last issued HLC), and
  `storage_persisted`.

## Derived values (pure functions, never stored)

**Event order.** Non-deleted events are sorted by `(local_date, occurred_at, id)`,
ascending.

**`deriveStatus(events)`** looks at the last event in that order:

| Last event | Status |
|---|---|
| none | `queued` |
| `started` or `progress` | `reading` |
| `finished` | `finished` |
| `abandoned` | `abandoned` |

**`lastPage(events)`** is the `page` of the last event in that order whose `page` is
not NULL, or `null` if there is none.

**`lastActivity(events)`** is the `(local_date, occurred_at)` of the last event. It
orders the Reading group, and the current book is the Reading book with the greatest
`lastActivity`.

## State transitions (book)

```
queued ──started──▶ reading ──progress──▶ reading
   ▲                  │  ├──finished──▶ finished ──started|progress──▶ reading (re-read)
   │                  │  └─abandoned──▶ abandoned ──started|progress──▶ reading
   └──(remove all events / remove only start)──┘
```

- `progress` on a `queued` book is allowed and makes it `reading`. There is no forced
  `started`.
- `finished` and `abandoned` are allowed only when the book is `reading`. Otherwise
  they are rejected with `InvalidTransition`.
- Removing an event (tombstoning it) re-derives status from the events that remain.

## Validation rules (from spec FR-002, FR-014)

| Input | Rule | Rejection |
|---|---|---|
| title | blank after trim | `TitleRequired` |
| total_pages | not an integer, or ≤ 0 | `InvalidPageCount` |
| page | not an integer, or ≤ 0 | `InvalidPage` |
| page | > total_pages (when known) | `PageBeyondEnd` |
| page | < lastPage | **accepted**: contributes 0 pages |
| event on a removed book | — | `NotFound` |
| remove an already-removed event | — | idempotent no-op (no changes) |
