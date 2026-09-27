# Contract: Commands and `decide` (packages/core)

The core exposes one write entry point. It is pure: it performs no I/O, reads no
clock, and uses no randomness.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function decide(
  snapshot: BookSnapshot | null,   // item + ALL its events (incl. tombstoned); null if unknown id
  cmd: Command,
  now: Instant,                     // supplied by shell
): Result<Decision, Rejection>;

interface BookSnapshot { item: Item; events: ReadingEvent[] }

interface Decision {
  changes: Change[];                // applied atomically by the shell, in order
  offerFinish: boolean;             // true when a progress page === total_pages (FR-007)
}

interface Change {                  // one row upsert
  tbl: 'items' | 'reading_events';
  rowId: string;
  fields: Record<string, string | number | null>;   // only the fields being set
}
```

## Commands

The shell generates every ID and puts it in the command. `localDate` is computed by
the shell (Today or Yesterday) at save time.

| Command | Payload | Changes emitted | Rejections |
|---|---|---|---|
| `AddBook` | `itemId, title, author?, totalPages?, genre?, startNow, startEventId?, localDate` | insert the item. If `startNow`, also insert a `started` event | `TitleRequired`, `InvalidPageCount`, `AlreadyExists` |
| `EditBook` | `itemId, title?, author?, totalPages?, genre?` | set only the fields that changed. An unchanged value emits nothing | `NotFound`, `TitleRequired`, `InvalidPageCount`, `PagesBelowLogged` (totalPages < max logged page) |
| `RemoveBook` | `itemId` | set `items.deleted_at = now` | `NotFound` (already removed → no-op, zero changes) |
| `LogEvent` | `itemId, eventId, type, page?, localDate` | insert an event with `occurred_at = now` | `NotFound`, `InvalidPage`, `PageBeyondEnd`, `PageNotAllowed` (a page on a non-progress event), `InvalidTransition` |
| `RemoveEvent` | `itemId, eventId` | set `reading_events.deleted_at = now` | `NotFound` (already removed → no-op) |

## Invariants (tested in `packages/core/test/decide.test.ts`)

1. `decide` is deterministic: the same inputs always give deep-equal outputs.
2. A rejection never comes with changes. The result is either `ok` with changes or an
   error.
3. After the changes are applied to the snapshot, `deriveStatus` and `lastPage` match
   the reference model for any random command sequence (SC-005).
4. A `LogEvent` that inserts `progress` with `page === item.total_pages` sets
   `offerFinish = true`. Every other command sets it to `false`.
5. No change ever sets a field on an existing `reading_events` row, except
   `deleted_at` (Constitution III).
