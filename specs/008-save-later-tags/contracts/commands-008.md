# Contract: Commands for saved articles and tags (`packages/core`)

All go through `decide(snapshot, command, now)`. Ids come in inside the command; tag and
assignment ids are derived in the shell (research R3).

| Command | Payload | Changes | Rejections |
|---|---|---|---|
| `AddArticle` (changed) | `readOn` becomes **optional**. When it's absent, the article is saved | insert with **`read_on: null` emitted explicitly in the change's fields**, never left out. `tierOf` depends on it (R2): a saved insert without the field would be `base`, and would break 0.8.0 devices | as 005 |
| `MarkArticleRead` | `itemId, readOn` | one op with **every** insert field plus `read_on` (S-2) | `NotFound` (missing, removed, not an article); `AlreadyRead`; `InvalidInput` (readOn) |
| `MarkArticleUnread` | `itemId` | `read_on = null` (the `s` tier) | `NotFound`; `NotRead` |
| `TagArticle` | `itemId, tagId, itemTagId, name` | insert or restore the tag if it's new or tombstoned; insert or restore the assignment | `NotFound` (item missing, removed or not an article); `InvalidInput { field: 'name' }` (empty after normalising, or over 40 characters); `TooManyTags { max: 20 }`. Already tagged gives no changes |
| `UntagArticle` | `itemTagId` | the assignment gets `deleted_at = now` | `NotFound`. Already removed gives no changes |
| `RenameTag` | `tagId, newName`, plus `merge?: { targetTagId, moves: { from: itemTagId, to: itemTagId, itemId }[] }` from the shell | either set `name` and `name_key`; or merge: insert or restore each `to`, tombstone each `from`, tombstone the source | `NotFound`; `InvalidInput { field: 'name' }`; `InvalidInput { field: 'merge' }` when `moves` doesn't equal the source's live assignments |
| `DeleteTag` | `tagId` | tombstone the tag and every live assignment | `NotFound` |
| `ReconcileSavedArticle` | `survivorId, duplicateId, copies: { from, to }[]` (highlight copies, content-addressed), `tagMoves` (as `RenameTag`) | the survivor gets `read_on` from the duplicate (if it's saved), emitted with **every article insert field** (R-2); copy the highlights; add the tags; the duplicate gets `deleted_at` plus `merged_into` | `InvalidInput` unless both are live articles with the same URL and the survivor is the older one |

## Pure helpers

```ts
function tagKey(name: string): string | null;          // nfkc, trim, collapse spaces, lower-case; null if empty
function tagName(name: string): Result<string, ParseError>;   // trimmed, 1..40
function searchKey(s: string): string;                  // NFD, strip marks, lower-case (research R5)
function tierOf(tbl: Table, fields: Readonly<Record<string, FieldValue>>): 'base' | 'h' | 't' | 's';
```

## Invariants (core tests, no mocks)

- **S-2:** see data-model.md.
- **T-1:** at most 20 live tags per article.
- **R-1:** reconcile is deterministic.
- **The existing merge property tests** extend to `ReconcileSavedArticle`.
