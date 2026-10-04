# Contract: Highlight commands (`packages/core`)

All go through `decide(snapshot, command, now)`. The snapshot carries the item (`id`,
`type`, `deletedAt`) and, for edits, the highlight row.

| Command | Payload | Changes | Rejections |
|---|---|---|---|
| `AddHighlight` | `highlightId, itemId, quote?, note?, page?, localDate` | Insert a `highlights` row: the normalised `quote` and `note` (R3), `page`, `created_at=now`, `local_date` | `InvalidInput` (id, localDate, page); `NotFound` (item missing or removed); `TooLong { field, max: 5000 }`; `HighlightEmpty` (quote and note both empty after normalising); `AlreadyExists` (id taken) |
| `EditHighlightNote` | `highlightId, note` (an empty note clears it) | Set `note` if it changed. Clearing it is rejected when there is no quote (it would leave the row empty) | `NotFound` (missing or removed); `TooLong`; `HighlightEmpty` |
| `RemoveHighlight` | `highlightId` | `deleted_at=now`; already removed gives no changes | `NotFound` (missing) |
| `RestoreHighlight` | `highlightId` | `deleted_at=null`; already live gives no changes | `NotFound` (missing) |

- **`page`:** must be a positive integer. It is accepted only for items of type
  `book`. Books get no UI until a later feature, but the data path is ready (FR-013).
- **New rejection kinds:** `TooLong` and `HighlightEmpty`. `errorMessage()` in the PWA
  maps them to "That passage is too long (5,000 characters max)" and "Add a quote or a
  note".

## Pure helpers

```ts
function normalizeQuote(s: string): Result<string | null, { kind: 'TooLong'; max: 5000 }>;   // research R3
function normalizeNote(s: string):  Result<string | null, { kind: 'TooLong'; max: 5000 }>;
function textFragment(quote: string): string;   // '#:~:text=…' (research R4)
function passageUrl(url: string, quote: string | null): string;   // url + textFragment, or url when quote is null
```

## Invariants (core tests, no mocks)

- **HL-1.** `AddHighlight` twice with the same id gives `AlreadyExists`.
- **HL-2.** The stored quote equals `normalizeQuote(input)` exactly.
- **HL-3.** `textFragment` round-trips: decoding the directive gives the first and last
  words of the normalised quote, with no raw `-`, `,`, `&` or `#`.
- **HL-4.** Remove then Restore gives the original row, with only the `deleted_at`
  clock advanced.
