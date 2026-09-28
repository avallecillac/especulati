# Contract: Command changes for 002 (packages/core)

This extends [001 contracts/commands.md](../../001-local-book-log/contracts/commands.md).
Everything there still holds: `decide` stays pure and deterministic, and a rejection
never carries changes.

## New domain type

```ts
type Isbn13 = Brand<string, 'Isbn13'>;              // 13 digits, prefix 978|979, valid mod-10 check digit
function parseIsbn(input: string): Result<Isbn13, ParseError>;   // research R6
type DetailsStatus = 'complete' | 'pending' | 'notFound';        // DB: 'ok' | 'pending' | 'failed'
```

`parseIsbn` rules:

1. Strip `[\s-]` and uppercase an `x`.
2. For 10 characters: `^\d{9}[\dX]$`, with the mod-11 check digit (`X` = 10). Convert
   to `978` + the first 9 digits + a recomputed mod-10 check digit.
3. For 13 characters: `^97[89]\d{10}$` with a valid mod-10 check digit.
4. Anything else gives `ParseError { field: 'isbn' }`.

Test vectors:

| Input | Result |
|---|---|
| `0-441-47812-3` | `9780441478125` |
| `978-0-441-17271-9` | `9780441172719` |
| `080442957X` | `9780804429573` |
| `9780441172718` | error: bad check digit |
| `9790001234566` | error when scanned: `9790` is ISMN (music). `parseIsbn` accepts it, and the scanner filters it out (research R3) |

`Item` gains three fields: `isbn: Isbn13 | null`, `coverUrl: string | null`, and
`detailsStatus: DetailsStatus`. They map to the columns `isbn`, `cover_url`, and
`metadata_status` (`ok` ↔ complete, `failed` ↔ notFound).

## Changed commands

| Command | New optional payload | Behavior |
|---|---|---|
| `AddBook` | `isbn?: string \| null`, `coverUrl?: string \| null`, `detailsStatus?: DetailsStatus` (default `complete`) | Sets `isbn` (normalized), `cover_url`, and `metadata_status` (always written, mapped). **When the title is blank and an ISBN is given, the title becomes `ISBN <isbn13>`** (FR-007). A blank title with no ISBN is still `TitleRequired`. |
| `EditBook` | `isbn?: string \| null`, `coverUrl?: string \| null`, `detailsStatus?: DetailsStatus` | Changed fields only, as in 001. Clearing the ISBN (`null`) is allowed. |

`coverUrl` must be `https://` and at most 500 characters. Otherwise the rejection is
`InvalidInput { field: 'coverUrl' }`.

## New command: `FillDetails` (automatic retry path, FR-009)

```ts
{ kind: 'FillDetails'; itemId: string;
  outcome: 'found' | 'notFound';
  details?: { title?: string; author?: string | null; totalPages?: number | null;
              genre?: string | null; coverUrl?: string | null } }
```

| Situation | Changes emitted |
|---|---|
| Item missing or removed | `NotFound` |
| `detailsStatus !== 'pending'` | **no changes**. Covers "retry succeeded while the user was editing": the user's save already changed the status. |
| `outcome = 'notFound'` | `{ metadata_status: 'failed' }` |
| `outcome = 'found'` | `metadata_status: 'ok'`, plus each detail field that passes its parser **and** whose current value is empty. Empty means:<br>• `title`: the current title equals the placeholder `ISBN <isbn>`<br>• `author`, `genre`, `cover_url`: null<br>• `total_pages`: null, **and** the new value ≥ the highest logged page (otherwise the field is skipped silently, not rejected) |

An invalid detail value, such as a blank title or 0 pages, is **skipped**, never
rejected. Catalog data is untrusted, and the retry must still clear the pending status.

## New rejection

`InvalidIsbn`: returned by `AddBook` and `EditBook` when `isbn` is present and fails
`parseIsbn`. The UI message is "That isn't a valid ISBN — check the digits."

## Invariants (added to the 001 set)

6. `FillDetails` never changes a field the user set: title (non-placeholder), author,
   genre, total_pages, cover_url. Property test: random user edits interleaved with
   `FillDetails` never overwrite a non-empty field.
7. `FillDetails` on a non-pending book emits zero changes.
8. The `isbn` stored by any command is always in `Isbn13` form.
