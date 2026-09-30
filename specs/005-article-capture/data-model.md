# Data Model: Article Capture (005)

**No migration.** Schema version stays 3. Articles use the `items` columns that have
existed since migration 1.

## Article (an `items` row with `type = 'article'`)

| Column | Type | Rule |
|---|---|---|
| id | ItemId | random for a manual add; derived for a capture (research R5) |
| type | `'article'` | |
| title | NonEmptyTitle | 1–500 characters (FR-021) |
| author | Author? | 1–200 characters, or null |
| url | NormalizedUrl | `http(s)` only, normalized (research R6) |
| domain | text | the host without a leading `www.` |
| word_count | integer? | 0..100000, or null when unknown (FR-007) |
| read_on | LocalDate | the capturing device's local date |
| metadata_status | `'ok'` \| `'failed'` | `failed` means "details not fetched" (a manual add) |
| created_at | Instant | when it was recorded |
| deleted_at | Instant? | tombstone |

Book-only columns (`total_pages`, `genre`, `isbn`, `cover_url`, `merged_into`) stay null.
Articles have **no** `reading_events`.

## Core types (`packages/core`)

| Type | Rule |
|---|---|
| `NormalizedUrl` | a branded string from `normalizeUrl` (research R6) |
| `WordCount` | an integer in 0..100000 |
| `Article` | `{ id, title, author, url, domain, wordCount, readOn, detailsStatus, createdAt, deletedAt }`, built by a `rowToArticle` mapper in db |

## Capture payload (the link from the Shortcut, and the message inside the extension)

```ts
interface CapturePayload { v: 1; url: string; title?: string; author?: string; words?: number; at: string /* ISO instant */ }
```

Encoding and validation rules are in `contracts/capture.md`.

## Extension storage (`chrome.storage.local`, extension only)

| Key | Value |
|---|---|
| `deviceId` | a UUID, created on first run |
| `hlc` | the last HLC this peer issued |
| `appOrigin` | e.g. `https://readerlog.pages.dev` |
| `syncKey` | the 32-byte sync code, base64url |
| `pending` | `OpWire[]` not yet sent |
| `pendingBatch` | `{ batchId, count }` while a push is in flight |
| `captured` | `{ [normalizedUrl]: { itemId, readOn, at, removed: boolean } }`, trimmed to the newest 5,000 |
| `status` | `{ lastSentAt, problem }` |

## Derived: `ArticleStats` (`core/stats.ts`)

`{ thisWeek, thisMonth, months: { month; count }[12], minutes, topSites: { domain; count }[≤5] }`.

- `thisWeek` counts from Monday to `today`.
- `minutes = round(sum(word_count) / 238)` over the **selected year**. Null word counts
  are ignored. `topSites` also covers the selected year.
- `topSites` is sorted by count descending, then domain ascending.
