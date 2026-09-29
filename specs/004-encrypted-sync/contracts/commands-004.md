# Contract: New commands (004)

These amend `specs/001-local-book-log/contracts/commands.md`. Both commands go through
`decide()`, then `applyChanges`, like every local write (constitution IV).

The snapshot for these commands is `{ books: BookSnapshot[] }`, holding both items with
all their events, loaded by `loadBooksSnapshot(db, ids)`.

## `MergeBooks`

```ts
{ kind: 'MergeBooks'; survivorId: string; duplicateId: string;
  copies: readonly { from: string; to: string }[] }
```

| Check | Rejection |
|---|---|
| a malformed id | `InvalidInput { field }` |
| either book is missing, or removed, **unless** this is a sweep: the duplicate is removed with `merged_into = survivorId` | `NotFound` |
| `survivorId === duplicateId` | `InvalidInput { field: 'duplicateId' }` |
| the survivor isn't the smaller `(created_at, id)` | `InvalidInput { field: 'survivorId', reason: 'not earliest' }` |
| `copies.from` isn't exactly the duplicate's live event ids | `InvalidInput { field: 'copies' }` |
| a `to` is malformed or equals an existing event id of the survivor | `InvalidInput { field: 'copies' }` |

**Changes emitted, in order:**

1. For each copy: insert a `reading_events` row with id `to`, `item_id = survivorId`,
   and the source event's `event_type`, `page`, `occurred_at` and `local_date`, with no
   `deleted_at`.
2. For each copy: set the source event's `deleted_at = now`.
3. On the survivor: set each of `author`, `total_pages`, `genre`, `isbn` and `cover_url`
   that is null there and not null on the duplicate (the FillDetails rule; nothing
   already set is overwritten). If `total_pages` would fall below the max page logged
   across both, keep the survivor's null.
4. On the duplicate item: set `deleted_at = now` and `merged_into = survivorId`. A sweep
   emits steps 1–2 only.

**Invariants** (`packages/core/test/decide.mergeBooks.test.ts`, plus a property test):

- **M-1.** The survivor's live events after the merge equal the union of both books'
  live events before it, as `(type, page, occurred_at, local_date)` multisets.
- **M-2.** `deriveStatus` and `lastPage` of the survivor after the merge equal those of
  a single book holding the union.
- **M-3.** Deciding the same command twice on the same snapshot is deep-equal
  (determinism). With the same `copies`, two devices' changes are identical, apart from
  `now`.

## `DismissDuplicate`

```ts
{ kind: 'DismissDuplicate'; dismissalId: string; itemA: string; itemB: string }
```

- **Rejections**: `InvalidInput` for malformed ids or `itemA === itemB`. It is
  idempotent: an existing live dismissal with this id gives no changes.
- **Changes**: insert `duplicate_dismissals` with
  `{ item_a: min, item_b: max, created_at: now }`.

## Shell helpers (`apps/pwa/src/lib/ids.ts`, WebCrypto)

```ts
function uuidFromHash(label: string): Promise<string>;   // SHA-256 → first 16 bytes → set version 4 / variant bits → lowercase UUID
const mergeCopyId = (survivorId, eventId) => uuidFromHash(`readerlog-merge-v1|${survivorId}|${eventId}`);
const dismissalId  = (a, b) => uuidFromHash(`readerlog-dismiss-v1|${min(a,b)}|${max(a,b)}`);
```
