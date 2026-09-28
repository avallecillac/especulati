# Contract: Migration 2 and worker API additions

## Migration 2 (`PRAGMA user_version` 1 → 2)

```sql
CREATE INDEX idx_items_isbn ON items(isbn) WHERE deleted_at IS NULL AND isbn IS NOT NULL;

-- Local cache of downscaled cover images (research R5). NOT in change_log, NOT synced.
CREATE TABLE covers (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg')),
  bytes      BLOB NOT NULL,
  width      INTEGER NOT NULL CHECK (width  BETWEEN 40 AND 2000),
  height     INTEGER NOT NULL CHECK (height BETWEEN 60 AND 480),
  fetched_at TEXT NOT NULL
) WITHOUT ROWID;
```

**Required tests:**

- A fixture database at v1, with books and events, migrates to v2 unchanged apart from
  the new objects, as the constitution's technical constraint requires.
- Running `migrate` on v2 is a no-op.
- `covers` is **not** in `applyChanges`'s writable map. Any change targeting it throws.

## `packages/db` additions

```ts
db.findByIsbn(isbn: string): BookCard | null;                 // non-removed only
db.pendingDetails(): { itemId: string; isbn: string }[];      // metadata_status = 'pending' AND isbn IS NOT NULL AND not removed
db.putCover(itemId: string, jpeg: Uint8Array, width: number, height: number, fetchedAt: string): void;  // upsert; the item must exist
db.getCover(itemId: string): { mime: 'image/jpeg'; bytes: Uint8Array } | null;
db.deleteCover(itemId: string): void;
```

`BookCard` gains three fields:

- `isbn: string | null`
- `detailsStatus: 'complete' | 'pending' | 'notFound'`
- `hasCover: boolean`, which is true when a `covers` row exists

## Worker API additions (extends 001 contracts/worker-api.md)

```ts
type Query = … | { name: 'findByIsbn'; isbn: string } | { name: 'pendingDetails' } | { name: 'cover'; itemId: string };
// QueryResult: findByIsbn → BookCard | null; pendingDetails → {itemId,isbn}[]; cover → Blob | null

type Request = … | { id; kind: 'storeCover'; itemId: string; image: Blob };
```

**`storeCover`** runs inside the worker:

1. `createImageBitmap(image)`.
2. Reject it if narrower than 40 px or shorter than 60 px, returning
   `{ ok: true, result: { stored: false } }`.
3. Scale it to at most 480 px tall, keeping the aspect ratio.
4. `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 })`.
5. `putCover`.
6. Post `changed`.

Decode or encode failures return `{ stored: false }`, never an error; a cover is always
optional.

**After a successful `RemoveBook` dispatch**, the worker calls `deleteCover(itemId)`
in the same worker turn (cache maintenance, research R5).

## Scanner worker (`apps/pwa/src/scanner/scanner.worker.ts`)

```ts
// UI → worker
type ScanIn = { kind: 'frame'; bitmap: ImageBitmap };            // transferred; center crop ≤ 1280 px wide
// worker → UI
type ScanOut = { kind: 'ready' } | { kind: 'isbn'; isbn: string } | { kind: 'none' } | { kind: 'error'; message: string };
```

- The worker lazily prepares `zxing-wasm/reader` with a self-hosted `locateFile`
  (research R3).
- It reads with `{ formats: ['EAN13'], tryHarder: true, maxNumberOfSymbols: 1 }`.
- It returns `isbn` only for text that passes the prefix filter (`978`, or `979` but not
  `9790`) and `parseIsbn`.
- The UI sends the next frame only after a reply, which gives back-pressure. It targets
  about 6 fps.
