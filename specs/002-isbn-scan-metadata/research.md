# Research: ISBN Scan & Book Metadata Lookup (002)

Each entry is written as Decision / Rationale / Alternatives. The probes below were run
from the dev container on 2026-09-28 with `Origin: https://readerlog.pages.dev`.

## R1. Catalog endpoints and CORS (verified)

| Endpoint | CORS | Result |
|---|---|---|
| `openlibrary.org/search.json?isbn=<13>&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject&limit=1` | `*` | **6/6 ISBNs found**: English, Spanish, 2018–2021 titles, and classics. Returns author names, subjects, a median page count and a cover id in **one request**. About 0.36–0.50 s |
| `openlibrary.org/isbn/<13>.json` | `*`, including on the 302 to `/books/OL…M.json` | The edition record: an exact `number_of_pages` and edition `covers[]`. Authors are only `{key}` references. About 0.67–0.86 s |
| `openlibrary.org/api/books?bibkeys=…&jscmd=data` | `*` | **404 or empty** for known ISBNs. Unreliable, so not used |
| `covers.openlibrary.org/b/id/<id>-L.jpg`, `/b/isbn/<13>-M.jpg?default=false` | `*` | A JPEG we can fetch as a blob. `default=false` gives a 404 instead of a placeholder |
| `googleapis.com/books/v1/volumes?q=isbn:<13>` | echoes the origin | **429: the anonymous daily quota is exhausted** from the container's shared IP |

- **Decision**: Open Library is the primary catalog. For an ISBN lookup, send
  **search-by-ISBN and the edition record in parallel**:
  - the search result supplies the title, authors, subjects, work cover, and
    first-publication year;
  - the edition supplies the exact page count and the edition cover, which win when
    present.

  Google Books is a **best-effort fallback**, queried only when Open Library search
  returns no document. Title search uses Open Library `search.json?q=…&limit=20`, with
  Google Books as the fallback when Open Library fails.
- **Rationale**: Open Library allows browser requests (CORS `*`), needs no key, and
  answered everything we tested. Google's anonymous quota is shared per IP, so it can't
  be the primary source.
- **Alternatives considered**:
  - `api/books?jscmd=data`: returns 404s.
  - Edition only, then separate author lookups: 2–3 extra requests.
  - Google Books first: unreliable without a key.
  - A user-supplied Google API key: deferred (YAGNI). It can be added to Settings later
    without changing any contract.

## R2. Lookup outcomes and the 8 s budget (FR-016, SC-004)

- **Decision**:
  - One `AbortSignal.timeout(8000)` covers the whole lookup, all requests included.
  - Every request uses `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`,
    `cache: 'no-store'`.
  - The outcome is classified as:

| Outcome | When |
|---|---|
| `found` | Some catalog returned a title |
| `notFound` | **Every** catalog queried answered successfully with no match |
| `unavailable` | No title, and at least one catalog failed: network error, 5xx, 429, or offline (`navigator.onLine === false`) |
| `timeout` | The 8 s deadline passed |

  `unavailable` and `timeout` keep the book **pending**. Only `notFound` marks it
  "not found".
- **Rationale**: a Google 429 must never turn into a permanent "not found" (FR-008,
  FR-009).
- **Alternatives considered**: per-request timeouts. They are harder to bound; two
  sequential 8 s requests would miss SC-004.

## R3. Barcode decoding

- **Decision**: **`zxing-wasm` 3.1.4, reader build** (`zxing-wasm/reader`).
  - It is verified in Node: `writeBarcode('9780441172719', EAN13)` →
    `readBarcodes(…, { formats: ['EAN13'] })` returns the same text with
    `isValid: true`.
  - **Self-hosted**: by default it fetches its WASM from jsDelivr, so we call
    `prepareZXingModule({ overrides: { locateFile } })` with
    `import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'`. This path is in the
    package `exports`.
  - It is precached by the service worker (953 KB) and **dynamically imported** only
    when the scan view opens, so startup doesn't pay for it.
  - Decoding runs in a dedicated `scanner.worker.ts`: the UI sends an `ImageBitmap`
    (transferred) of the center crop at about 6 fps and gets `{ text }` or nothing
    back.
- **Formats**: only `EAN13`. An ISBN on a book is always printed as an EAN-13 "Bookland"
  barcode, so there is no separate ISBN-10 symbology. Typed ISBN-10s are handled by
  **Enter ISBN**. A value is accepted only if it starts with `978`, or with `979` but
  not `9790` (ISMN, which is music), and it passes `parseIsbn`. EAN-5 price add-ons are
  ignored.
- **Rationale**:
  - Safari has no `BarcodeDetector`, so a WASM decoder is needed for iOS.
  - Self-hosting is required by offline use (Constitution I) and privacy
    (Constitution II).
  - A worker keeps the camera preview smooth.
- **Alternatives considered**:
  - The `barcode-detector` polyfill: it wraps zxing-wasm anyway, one layer more.
  - Native `BarcodeDetector` where available: a second code path for no user benefit.
  - QuaggaJS: unmaintained.

## R4. Camera

- **Decision**:
  - `getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })`.
  - On close, on route change, and on `visibilitychange → hidden`, stop every track, so
    the indicator light turns off (FR-014, edge case).
  - Frames are never stored.
  - `NotAllowedError` or `NotFoundError` routes the user to **Enter ISBN** with the
    reason (US4 · 1).
  - A hint appears after 10 s without an ISBN.
  - Success feedback: `navigator.vibrate?.(40)`, which is Android and Chrome only, plus
    a visual flash, since iOS has no vibrate.
- **iOS note**: camera access works in home-screen web apps on iOS 17+, but WebKit may
  ask for permission again on each app launch. This is platform behavior; it is
  documented in quickstart.
- **E2E strategy**: Playwright can't aim a camera at a book. An init script replaces
  `navigator.mediaDevices.getUserMedia` with a `canvas.captureStream()` that draws a
  barcode PNG generated at test time with `zxing-wasm/full`'s `writeBarcode` (a dev
  dependency of e2e). This exercises the real decode path, including the worker and
  the WASM.

## R5. Covers

- **Decision**:
  - **Source**, in priority order: the edition cover id, then the search `cover_i`
    (`covers.openlibrary.org/b/id/<id>-L.jpg`), then the Google `imageLinks.thumbnail`
    (forced to https, `&zoom=1`).
  - **Download** as a blob from the UI thread, then send it to the DB worker with a
    `storeCover(itemId, blob)` request.
  - **Normalize in the worker**: `createImageBitmap` → `OffscreenCanvas` scaled to
    **at most 480 px tall** → JPEG at quality 0.75, which averages about 25–35 KB.
    1,000 covers come to about 35 MB, under the FR-010 limit of 50 MB.
  - **Reject** images narrower than 40 px or shorter than 60 px, which are placeholders.
  - **Store** in a new SQLite table `covers` (migration 2). It is a **local cache**:
    not written to `change_log`, not synced, and re-fetchable from `items.cover_url`.
  - **Remove**: after a successful `RemoveBook`, the worker deletes the cache row
    (FR "Stored Cover … removed when its book is removed"). This is cache maintenance
    outside `decide()`, like any cache.
  - **Display**: the UI asks the worker for the `cover` blob and caches an object URL
    per item. Books without a cover get a generated cover: title initials on a color
    derived from a hash of the item id.
- **Rationale**: a SQLite blob is transactional, lives in the same OPFS pool, and needs
  no second storage API. Downscaling keeps FR-010 comfortably within budget. Keeping
  covers out of `change_log` keeps sync (feature 004) small, since covers can be
  re-fetched.
- **Alternatives considered**:
  - A separate OPFS directory: a second store to keep consistent.
  - The Cache API: can be evicted independently of the DB.
  - Storing the original images: 100–300 KB each would break FR-010.
  - Putting cover bytes in `change_log`: would bloat sync.

## R6. Parsing ISBNs (core)

- **Decision**: `parseIsbn(input): Result<Isbn13, ParseError>` in `packages/core`.
  1. Strip spaces and hyphens, and uppercase `x`.
  2. Accept 10 characters (check digit mod 11, `X` = 10), converted to `978…` plus a
     recomputed mod-10 check digit.
  3. Accept 13 digits (mod-10 check digit), with prefix `978` or `979`.
  4. Reject everything else.
- **Rationale**: pure domain logic (Constitution IV), shared by scanning, Enter ISBN,
  and edit. It normalizes before duplicate detection, which covers the edge case of
  several ISBNs on one book.

## R7. Commands (core)

- **Decision**:
  - Extend `AddBook` and `EditBook` with `isbn`, `coverUrl` and `detailsStatus`.
  - Add `FillDetails` for the automatic retry path, as specified in
    [contracts/commands-002.md](contracts/commands-002.md).
  - The placeholder title `ISBN <13>` is produced by `decide()` when the title is blank
    and an ISBN is present.
  - `FillDetails` only acts on a **pending** book, and only fills fields that are
    null or still at their placeholder. This makes the "retry while editing" edge case
    safe by construction.
- **Rationale**: all writes still go through `decide()`, and the fill-only-empty rule is
  pure, so it can be tested exhaustively without mocks.
- **Status naming**: the database keeps 001's `metadata_status` values
  (`ok` | `pending` | `failed`). The spec's complete, pending and not-found statuses map
  1:1 to these; the UI and read models use the spec names. Renaming the column values
  would need a migration of synced data for no user benefit.

## R8. Retrying automatically (FR-009)

- **Decision**: a main-thread module `detailsRetry.ts` runs after the DB is ready and on
  every `online` event.
  1. Query `pendingDetails`.
  2. Look up at most **2 books concurrently**.
  3. Skip ids already attempted during this launch (an in-memory set).
  4. On `found` or `notFound`, dispatch `FillDetails`, then download the cover for
     `found`.
  5. `unavailable` or `timeout`: leave the book pending, and don't try again until the
     next launch.
- **Rationale**: this is FR-009's "at most once per app launch per book". It needs no
  background sync, which the iOS web platform doesn't offer.

## R9. Detecting duplicates (FR-012)

- **Decision**: a read query `findByIsbn(isbn)` returns the non-removed book card, or
  null. Migration 2 adds a partial index `idx_items_isbn ON items(isbn) WHERE
  deleted_at IS NULL`. The UI checks it **after scan or Enter ISBN, before the lookup**,
  and offers **Open existing** or **Add another copy**.
- **Rationale**: this is not a rejection in `decide()`, because the user is allowed to
  add another copy. Checking before the lookup also saves a network round trip.

## R10. Mapping genres

- **Decision**: a pure `genreFromSubjects(subjects)` with an ordered keyword table.
  Earlier rows win, so specific genres come first.

| Genre | Matches (case-insensitive substring) |
|---|---|
| Science Fiction | science fiction, science-fiction, sci-fi, ciencia-ficción, ciencia ficción |
| Fantasy | fantasy, fantasía |
| Mystery & Thriller | mystery, thriller, detective, crime, suspense, novela negra |
| Romance | romance |
| Horror | horror, terror |
| Historical Fiction | historical fiction, novela histórica |
| Biography & Memoir | biography, autobiography, memoir, biografía |
| History | history, historia |
| Science | science, physics, biology, astronomy, ciencia |
| Philosophy | philosophy, filosofía |
| Psychology | psychology, psicología |
| Business & Economics | business, economics, management, economía |
| Self-Help | self-help, personal development, autoayuda |
| Poetry | poetry, poesía |
| Fiction | fiction, ficción, novela, novel |

  No match gives null. The raw first subject is never used; subjects such as "Dune
  (Imaginary place)" would be noise.
- **Rationale**: the spec wants a suggested, editable genre, and feature 003 groups by
  it. A small fixed vocabulary keeps the abandon-rate-by-genre stat meaningful.

## R11. Checking page counts

- **Decision**: a catalog page count is used only if it is an integer from **1 to
  10,000**; otherwise it is treated as missing (spec edge case). The edition's
  `number_of_pages` wins over the search `number_of_pages_median`.

## R12. Where the catalog code lives and how it's tested

- **Decision**: in `apps/pwa/src/catalog/`:
  - `isbnLookup.ts`, `titleSearch.ts`: orchestration, with `fetch` injected;
  - `openLibrary.ts`, `googleBooks.ts`: pure response parsers;
  - `merge.ts`, `genre.ts`.

  Unit tests run in a new Vitest project `pwa` (Node environment, `src/**/*.test.ts`)
  against **recorded JSON fixtures** in `apps/pwa/src/catalog/fixtures/`. They are
  recorded once from the live APIs, for the 6 R1 ISBNs, one miss, and one Spanish
  title search.

  E2E intercepts the catalog and cover hosts with `page.route`, so CI never calls
  third parties.

  A **manual** script, `pnpm --filter pwa catalog:coverage`, runs the SC-002 reference
  set of 20 ISBNs against the live APIs and prints the hit rates.
- **Rationale**: the parsers are pure but specific to each catalog. They are shell
  adapters, not domain logic, so they don't belong in `packages/core`. They have one
  consumer, so there is no new package (Constitution VI).
- **Alternatives considered**:
  - A `packages/catalog` package: only one consumer.
  - Live APIs in CI: flaky, and against the privacy spirit of the constitution.

## R13. New runtime dependency

- **Decision**: `zxing-wasm@3.1.4`. It is the only new runtime dependency, justified in
  R3. `zxing-wasm/full` is a dev dependency of e2e only, for generating test barcodes.

All Technical Context unknowns are resolved.
