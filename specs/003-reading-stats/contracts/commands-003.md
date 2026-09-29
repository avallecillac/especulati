# Contract: Command changes (003)

This amends `specs/001-local-book-log/contracts/commands.md`.

## `LogEvent`

```ts
{ kind: 'LogEvent'; itemId; eventId; type: EventType; page?: number | null; localDate;
  pageEventId?: string }   // new: only with type 'abandoned' and a page
```

| Input | Result |
|---|---|
| `progress` with or without a page | unchanged from 001 |
| `started` or `finished` with a page | `PageNotAllowed`, unchanged |
| `abandoned` with no page | unchanged: one `abandoned` insert |
| `abandoned` with a page, **without** `pageEventId` | `PageNotAllowed` |
| `abandoned` with a page and `pageEventId` | **two inserts**: a `progress` event (id `pageEventId`, page) and then an `abandoned` event (id `eventId`, page null), with the same `local_date` and `occurred_at = now` |

**Validation**, in this order:

1. `pageEventId` must be a UUID different from `eventId`; otherwise
   `InvalidInput { field: 'pageEventId' }`.
2. The page itself: `InvalidPage` or `PageBeyondEnd`. A page below the last logged
   page is allowed.
3. The transition: `abandoned` is allowed only from `reading`
   (`InvalidTransition`).

`offerFinish` is always false for an abandon.

## `eventOrder` (packages/core/src/book.ts)

Events are sorted by `(local_date, occurred_at, typeRank, id)`, where `typeRank` is:

| Type | Rank |
|---|---|
| `started` | 0 |
| `progress` | 0 |
| `finished` | 1 |
| `abandoned` | 1 |

`deriveStatus`, `lastPage` and `lastActivity` all use it. So after an abandon at a
page, the book's status is `abandoned` and its last page is N, on every device.

## New invariants (`packages/core/test/decide.logEvent.test.ts` and the property test)

- **I-9.** For any abandon at a page N, applying the changes gives
  `deriveStatus = 'abandoned'` and `lastPage = N`, whatever the two ids are.
- **I-10.** Removing only the `abandoned` event gives `reading` at page N. Removing
  only the `progress` event gives `abandoned`, with the previous last page.
