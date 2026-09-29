---

description: "Task list for 002-isbn-scan-metadata"
---

# Tasks: ISBN Scan & Book Metadata Lookup

**Input**: Design documents from `/specs/002-isbn-scan-metadata/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (commands-002, catalog-lookup, db-and-worker-002), quickstart.md

**Tests**: REQUIRED (Constitution VII). Write each test task first and confirm it fails
before implementing it.

**Execution**: per CLAUDE.md "Model roles", each task, or each `[P]` batch, goes to the
`implementer` agent (Sonnet). Tasks marked **(main session)** are design or doc edits
that the Opus session does itself.

**Always-applicable rules for every task:**

- `packages/core` is pure: no DOM, `fetch`, `Date.now`, `new Date`, `Math.random`, or
  `crypto.randomUUID`, and no imports from other packages.
- All domain writes go through `decide()`, then `applyChanges`.
- Rows are never deleted; removal sets `deleted_at`.
- The UI talks to SQLite only through `apps/pwa/src/lib/dbClient.ts`.
- **No request may reach `openlibrary.org`, `covers.openlibrary.org` or
  `googleapis.com` from any automated test.** Unit tests inject `fetch`, and e2e uses
  `e2e/fixtures/catalog.ts` (T016).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add dependencies and test wiring:
  - `apps/pwa/package.json`: dependency `"zxing-wasm": "3.1.4"`.
  - `e2e/package.json`: devDependency `"zxing-wasm": "3.1.4"`.
  - `vitest.config.ts`: add a third project
    `{ test: { name: 'pwa', root: 'apps/pwa', environment: 'node', include: ['src/**/*.test.ts'] } }`.
  - `apps/pwa/tsconfig.json`: make sure `src/**/*.test.ts` typechecks (add
    `"vitest/globals"` only if needed; tests import from `vitest` explicitly).
  - Run `pnpm install`. Verify `pnpm test` still passes all 98 existing tests and
    reports 0 tests for project `pwa`.
- [X] T002 [P] Record catalog fixtures into `apps/pwa/src/catalog/fixtures/`. This is
  the **only** task allowed to call the live APIs, and it runs once, with curl.
  - For each ISBN in `9780441478125 9780441172719 9780307387899 9788437604947 9780593135204 9781250301697`:
    - save `ol-search-isbn-<isbn>.json` from
      `https://openlibrary.org/search.json?isbn=<isbn>&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject&limit=1`;
    - save `ol-edition-<isbn>.json` from `https://openlibrary.org/isbn/<isbn>.json`
      (follow the redirect, `curl -L`).
  - Save `ol-search-isbn-miss.json` from the same search URL with `isbn=9791299999991`
    (expect `docs: []`). *As built:* `9780000000002` turned out to be a real ISBN in Open Library, so the miss ISBN is `9791299999991`: a valid check digit with `numFound: 0`, verified live on 2026-09-28.
  - Save `ol-search-q-left-hand.json` from
    `https://openlibrary.org/search.json?q=left+hand+of+darkness&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject,isbn&limit=20`.
  - Write `gb-isbn-9780441172719.json` by hand, following the Google Books `volumes`
    schema (`{ totalItems: 1, items: [{ volumeInfo: { title, authors, pageCount, categories, imageLinks: { thumbnail: "http://books.google.com/books/content?id=…&zoom=1" } } }] }`),
    because the anonymous quota returns 429.
  - Also write `gb-429.json` with the real 429 error body shape
    (`{ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }`).
  - Keep each file pretty-printed and trimmed to the fields actually used.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: ISBN domain type, schema v2, covers, BookCard fields, the catalog lookup,
and the e2e harness.

### Tests first

- [X] T003 [P] Write `packages/core/test/isbn.test.ts` for `parseIsbn`, following
  contracts/commands-002.md:
  - every row of the test-vector table: `0-441-47812-3` → `9780441478125`;
    `978-0-441-17271-9` → `9780441172719`; `080442957X` → `9780804429573`;
    `9780441172718` → error; `9790001234566` → accepted by `parseIsbn`;
  - spaces and lowercase `x` accepted;
  - wrong lengths, letters, `977…` prefix, and a bad ISBN-10 check digit all rejected
    with `ParseError { field: 'isbn' }`.

  Also test `parseCoverUrl`: `https://…` accepted; `http://…`, over 500 characters, and
  `javascript:` rejected.
- [X] T004 [P] Write `packages/core/test/decide.addBook.isbn.test.ts` for the
  commands-002 "Changed commands" table:
  - `AddBook` with `isbn: '0-441-47812-3'` stores `isbn: '9780441478125'`;
  - a blank title plus an ISBN gives the title `ISBN 9780441478125`;
  - a blank title with no ISBN is still `TitleRequired`;
  - `detailsStatus` `pending` → `metadata_status: 'pending'`, `notFound` → `'failed'`,
    and the default is `'ok'` (always written);
  - `coverUrl` is stored when https, and `http://x` gives
    `InvalidInput { field: 'coverUrl' }`;
  - an invalid ISBN gives `{ kind: 'InvalidIsbn' }`;
  - `EditBook`: setting, changing and clearing (`null`) the ISBN emits only changed
    fields; `detailsStatus: 'complete'` on a pending book emits
    `metadata_status: 'ok'`.
- [X] T005 [P] Write `packages/db/test/migration2.test.ts`:
  1. Build a **v1 fixture database**: run only migration 1, by exposing
     `migrate(db, { to: 1 })` or an equivalent test hook in
     `packages/db/src/migrations.ts`, then add 2 books with events through `dispatch`.
  2. Take a `dumpLogical` of `items`, `reading_events`, `change_log`, and
     `field_clock`.
  3. Run `migrate` to v2. `PRAGMA user_version` is 2, the dumps are identical, and
     `idx_items_isbn` and `covers` exist.
  4. Running `migrate` again is a no-op.

  Also check that `applyChanges` rejects `{ tbl: 'covers', … }` with `/table/`.
- [X] T006 [P] Write `packages/db/test/covers-and-queries.test.ts`:
  - `putCover` and then `getCover` round-trip the bytes; `putCover` upserts; the
    `covers` CHECK rejects height 481 and width 39; `deleteCover` removes the row;
  - `BookCard` has `isbn`, `detailsStatus` (`ok` → `complete`, `failed` →
    `notFound`), and `hasCover`;
  - `findByIsbn` returns the non-removed book and null after `RemoveBook`;
  - `pendingDetails` lists only pending, non-removed books that have an ISBN;
  - no cover write ever adds a `change_log` row.

### Implementation

- [X] T007 [P] In `packages/core/src/types.ts`, add:
  - `export type Isbn13 = Brand<string, 'Isbn13'>` and
    `parseIsbn(input: string): Result<Isbn13, ParseError>`, implementing the rules in
    contracts/commands-002.md "parseIsbn rules" exactly;
  - `export type CoverUrl = Brand<string, 'CoverUrl'>` and
    `parseCoverUrl(input: string): Result<CoverUrl, ParseError>`: "`https://…`, at
    most 500 characters".
- [X] T008 Update the core types, following contracts/commands-002.md:
  - `packages/core/src/book.ts`: add to `Item` `isbn: Isbn13 | null`,
    `coverUrl: CoverUrl | null`, and
    `detailsStatus: 'complete' | 'pending' | 'notFound'`. Export
    `type DetailsStatus`.
  - `packages/core/src/commands.ts`: add to `AddBook` and `EditBook` the optional
    `isbn?: string | null`, `coverUrl?: string | null`, and
    `detailsStatus?: DetailsStatus`. Add the `FillDetails` command type exactly as in
    the contract. Add the rejection `{ kind: 'InvalidIsbn' }`.
  - `packages/core/test/fixtures.ts`: update the `book()` default
    (`isbn: null, coverUrl: null, detailsStatus: 'complete'`) and `applyToSnapshot`
    for the new columns.
  - In `packages/core/src/decide.ts`, make `FillDetails` return
    `err({ kind: 'InvalidInput', field: 'command', reason: 'FillDetails not implemented' })`
    until T031.
- [X] T009 Implement the `AddBook`/`EditBook` additions in
  `packages/core/src/decide.ts`, as described by T004 and the contract.
  - Map `DetailsStatus` to the DB value with a single exported helper:
    `detailsStatusToDb` / `detailsStatusFromDb` in `book.ts`.
  - The placeholder title is exactly `` `ISBN ${isbn13}` ``.
  - Make T003 and T004 pass, with all 001 core tests still green.
- [X] T010 In `packages/db/src/migrations.ts`, add migration 2 with the DDL copied
  verbatim from contracts/db-and-worker-002.md "Migration 2". Add the `to` option (or
  equivalent) used by T005. `SCHEMA_VERSION` becomes 2.
- [X] T011 Update `packages/db/src/snapshot.ts`: `rowToItem` maps `isbn`, `cover_url`,
  and `metadata_status`, using `detailsStatusFromDb`. Unknown values throw, like the
  other converters.
- [X] T012 [P] Create `packages/db/src/covers.ts` with `putCover`, `getCover` and
  `deleteCover`, as in contracts/db-and-worker-002.md. `putCover` uses
  `INSERT … ON CONFLICT(item_id) DO UPDATE`. None of them touches `change_log` or
  `field_clock`.
- [X] T013 Update `packages/db/src/queries.ts` and `packages/db/src/index.ts`:
  - `BookCard` gains `isbn`, `detailsStatus` and `hasCover`. Compute `hasCover` with
    one `SELECT item_id FROM covers` into a Set.
  - Add `findByIsbn(isbn)` (uses `idx_items_isbn`, non-removed, type book) and
    `pendingDetails()`.
  - Expose `putCover`, `getCover`, `deleteCover`, `findByIsbn` and `pendingDetails` on
    `ReaderlogDb`.

  Make T005 and T006 pass.
- [X] T014 Update the worker and client (`apps/pwa/src/lib/protocol.ts`,
  `apps/pwa/src/worker/db.worker.ts`, `apps/pwa/src/lib/dbClient.ts`), following
  contracts/db-and-worker-002.md "Worker API additions":
  - Add the queries `findByIsbn`, `pendingDetails` and `cover` (returns a `Blob` of
    `image/jpeg`, or null).
  - Add the request `storeCover { itemId, image: Blob }`, running the six steps listed
    in the contract.
  - After a successful `RemoveBook` dispatch, call `deleteCover(itemId)`.
  - Add `storeCover(itemId, blob)` and typed query overloads to `dbClient.ts`.
  - Add a message for `InvalidIsbn` in `apps/pwa/src/lib/errors.ts`: "That isn't a
    valid ISBN — check the digits."
- [X] T015 [P] Implement and test the catalog layer in `apps/pwa/src/catalog/`, following
  contracts/catalog-lookup.md. Write the tests first, as `*.test.ts` beside each file.
  Every test uses a fake `fetch` that serves the T002 fixtures by URL.
  - `genre.ts`: `genreFromSubjects`, with the ordered table from research R10 copied
    verbatim. Tests: "Ciencia-ficción" → Science Fiction; the Dune fixture subjects →
    Science Fiction (the specific genre is listed before Fiction); no match → null.
  - `openLibrary.ts` and `googleBooks.ts`: pure parsers from fixture JSON to partial
    `BookDetails`. Page counts are kept only when they are integers from 1 to 10,000.
    Cover ids ≤ 0 are ignored. Google thumbnails are rewritten to `https://`.
  - `merge.ts`: `authorsLabel` (`[]` → null, `["A"]` → "A", `["A","B"]` → "A & B",
    `["A","B","C"]` → "A, B & C"), plus the four merge rules.
  - `isbnLookup.ts`: `lookupIsbn(isbn, { fetch, online, timeoutMs = 8000 })`.
    - Requests #1 and #2 run in parallel; #3 only runs when #1 has no doc.
    - One `AbortSignal.timeout` covers everything.
    - Every request passes `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`,
      `cache: 'no-store'`.
    - Outcomes follow research R2. Required tests:
      - each of the 6 fixtures → `found`, with the expected title, authors, and
        edition page count (e.g. Dune gives the edition's `number_of_pages` when
        present, else 608);
      - a miss on OL plus a GB `totalItems: 0` → `notFound`;
      - a miss on OL plus a GB 429 → `unavailable` (quickstart scenario 8);
      - `online()` false → `unavailable/offline`, with **no fetch call made**;
      - a hanging fetch plus `timeoutMs: 50` → `timeout`;
      - #2 returning 404 still gives `found`.
  - `cover.ts`: `fetchCover(url, { fetch, timeoutMs })`, returning null on non-2xx, a
    non-image content type, or under 1 KB.
- [X] T016 [P] Create the e2e harness in `e2e/fixtures/catalog.ts`. Export a Playwright
  `test` extended with fixtures:
  - `catalog`: registers `page.route` handlers for `https://openlibrary.org/**`,
    `https://covers.openlibrary.org/**` and `https://www.googleapis.com/**`.
    - They serve JSON from `apps/pwa/src/catalog/fixtures/`, and a generated 300×450
      JPEG for cover URLs (created once with the canvas in the page or a static file
      at `e2e/fixtures/cover.jpg`).
    - Its API: `catalog.miss(isbn)`, `catalog.delay(ms)`, `catalog.fail(host, status)`,
      and `catalog.requests()`, which lists the URLs seen.
    - **Guard**: any request to those hosts that no handler matched fails the test.
  - `fakeCamera`: an init script that replaces `navigator.mediaDevices.getUserMedia`
    with a `canvas.captureStream(10)` drawing a PNG barcode for a given value.
    - The PNG is generated in Node with `zxing-wasm/full`'s
      `writeBarcode(value, { format: 'EAN13', scale: 4 })` and passed as a data URL.
    - Its API: `fakeCamera.show(value)`, `fakeCamera.deny()` (rejects with
      `NotAllowedError`), and `fakeCamera.stoppedTracks()`, which counts
      `track.stop()` calls.
  - Add a self-test `e2e/harness.spec.ts`. It checks that the guard fails an unrouted
    call, and that the fake camera stream has a video track.

**Checkpoint**: `pnpm test` is green: core, db, and the pwa catalog tests. The app still
builds, and the existing 001 e2e suite still passes.

---

## Phase 3: User Story 1 - Scan a book's barcode to add it (Priority: P1) 🎯 MVP

**Goal**: Add → Scan barcode → auto-detect → a filled-in confirmation → Save → the
current book, with its cover.

**Independent Test**: with routed catalogs and the fake camera showing
`9780441172719`, three taps give Dune as the current book, with its cover.

### Tests for User Story 1

- [X] T017 [P] [US1] Write `apps/pwa/src/scanner/isbnFilter.test.ts` for
  `isbnFromBarcode(text)`:
  - it accepts `978…` and `979` (except `9790…`) EAN-13 values that pass `parseIsbn`;
  - it rejects UPC-A (12 digits), `9790001234566`, bad check digits, and
    non-numerics.
- [X] T018 [P] [US1] Write `e2e/scan.spec.ts` using the T016 fixtures:
  - **(a)** Add → **Scan barcode** with `fakeCamera.show('9780441172719')`. The
    confirmation shows the title "Dune", author "Frank Herbert", and the fixture page
    count, and a cover preview. **Save** with Start reading on: the Home card shows
    Dune and a cover `<img>`. Count the clicks: exactly 2 after reaching Add, so 3 in
    total with the Add tab (SC-001).
  - **(b)** Show a UPC (`012345678905`), then `9790001234566`. Nothing is accepted.
    After 10 s (use `page.clock`) the hint "Enter ISBN" is visible.
  - **(c)** Leaving the scan view stops every track (`fakeCamera.stoppedTracks()` ≥ 1,
    and the live track count is 0) (FR-014).
  - **(d)** Duplicates (FR-012, SC-005): scan Dune a second time. A dialog offers
    **Open existing** (navigates to the book) and **Add another copy**. Choosing Open
    existing leaves the library with exactly 1 Dune.

### Implementation for User Story 1

- [X] T019 [P] [US1] Create `apps/pwa/src/scanner/isbnFilter.ts`, satisfying T017.
- [X] T020 [US1] Create `apps/pwa/src/scanner/scanner.worker.ts`, following
  contracts/db-and-worker-002.md "Scanner worker":
  - Lazily run
    `prepareZXingModule({ overrides: { locateFile: (p, prefix) => p.endsWith('.wasm') ? wasmUrl : prefix + p } })`,
    with `import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'`.
  - Decode with
    `readBarcodes(imageData, { formats: ['EAN13'], tryHarder: true, maxNumberOfSymbols: 1 })`,
    getting the `ImageData` from an `OffscreenCanvas` drawing of the transferred
    `ImageBitmap`.
  - Filter with `isbnFromBarcode`, then reply `ready` / `isbn` / `none` / `error`.
- [X] T021 [US1] Create `apps/pwa/src/scanner/camera.ts` with
  `startCamera(video: HTMLVideoElement): Promise<Result<MediaStream, 'denied' | 'unavailable'>>`
  and `stopCamera(stream)`, which stops every track.
  - Use the constraints from research R4.
  - Map `NotAllowedError` → `denied`; `NotFoundError`, `OverconstrainedError` and a
    missing `mediaDevices` → `unavailable`.
  - Add a frame loop helper `scanFrames(video, worker, onIsbn)`: grab the center crop
    with `createImageBitmap(video, sx, sy, sw, sh)`, keep one frame in flight, and
    target about 6 fps. It returns a stop function.
- [X] T022 [US1] Create `apps/pwa/src/lib/draft.svelte.ts`: a `$state` holding the
  confirmation draft.
  - Fields: `{ source: 'scan' | 'isbn' | 'search' | 'manual'; isbn: string | null;`
    `lookup: 'idle' | 'running' | 'found' | 'notFound' | 'unavailable' | 'timeout';`
    `details: BookDetails | null }`.
  - Create `apps/pwa/src/lib/isbnFlow.ts` with
    `startIsbnFlow(isbn): Promise<'duplicate' | 'started'>`:
    1. Call `query({ name: 'findByIsbn', isbn })`. If a book is found, return
       `'duplicate'`, and the caller shows the choice dialog.
    2. Otherwise set the draft to `lookup: 'running'`, navigate to `#/add`, and start
       `lookupIsbn(isbn, { fetch, online: () => navigator.onLine })`, updating the
       draft as it resolves.
- [X] T023 [US1] Create `apps/pwa/src/screens/Scan.svelte`, with route `#/scan` added in
  `apps/pwa/src/lib/router.svelte.ts` and `App.svelte`.
  - It shows a full-width `<video playsinline muted>` with a framing guide.
  - It starts the camera on mount and stops it on destroy and on
    `visibilitychange → hidden`.
  - On an ISBN: `navigator.vibrate?.(40)`, a visual flash, stop the camera, then call
    `startIsbnFlow`.
  - On `'duplicate'`, show the `Confirm` dialog "Already in your library" with
    **Open existing** and **Add another copy**. Add another copy continues the flow
    and skips the duplicate check.
  - After 10 s without an ISBN, show a hint link: "Having trouble? **Enter ISBN**".
  - On `denied` or `unavailable`, show the reason and an **Enter ISBN** button (US4
    wires the destination).
- [X] T024 [US1] Rework `apps/pwa/src/screens/AddBook.svelte` (add mode only; edit mode
  stays as in 001, and US5 extends it):
  - At the top, a primary **Scan barcode** button (→ `#/scan`) and secondary links
    **Search by title** and **Enter ISBN**. Wire them later in US3 and US4; until
    then, render them disabled with `aria-disabled`.
  - Below that, the existing form, prefilled from the draft when one exists:
    - title, author (`authorsLabel`), total pages, genre;
    - a cover preview using `Cover.svelte` (T025), with the draft's `coverUrl`;
    - a lookup status line: "Looking up…", "Found in Open Library", and so on.
  - **Save** dispatches `AddBook` with `isbn`, `coverUrl`, and
    `detailsStatus: 'complete'` when the lookup was `found`. It then runs
    `fetchCover` followed by `storeCover` without awaiting in the UI (fire and
    forget), clears the draft, and navigates to `#/`.
- [X] T025 [P] [US1] Create `apps/pwa/src/screens/Cover.svelte` and
  `apps/pwa/src/lib/covers.ts`.
  - `covers.ts` has `coverObjectUrl(itemId)`, which calls
    `query({ name: 'cover', itemId })`, keeps a `Map` of object URLs, and revokes
    them on `onChanged`.
  - `Cover.svelte` props: `{ itemId?: string; url?: string | null; title: string; size: 'sm' | 'md' }`.
    - It shows the stored blob when `itemId` has a cover, else the remote `url`
      preview (draft only), else a generated cover: up to 2 initials on an HSL color
      from a hash of the title or id.
    - `alt` is `Cover of <title>`.
  - Use it on the Home card (`md`), the Library rows (`sm`) and BookDetail (`md`).

**Checkpoint**: US1 works on its own. T017 and T018 pass, and the 001 e2e suite is
still green.

---

## Phase 4: User Story 2 - Add a book when the lookup can't help (Priority: P1)

**Goal**: saving never waits on the network. A pending book fills itself in later,
without overwriting anything the user typed.

**Independent Test**: go offline, scan and save, and the book shows "ISBN 978…" as
Details pending. Go back online and reload: the details fill in, and an author typed
in the meantime is kept.

### Tests for User Story 2

- [X] T026 [P] [US2] Write `packages/core/test/decide.fillDetails.test.ts` for every row
  of the contracts/commands-002.md `FillDetails` table:
  - NotFound for a missing or removed book;
  - a non-pending book gives zero changes (invariant 7);
  - `notFound` → `{ metadata_status: 'failed' }`;
  - `found` fills the placeholder title but not a typed title;
  - author, genre and cover_url are filled only when null;
  - total_pages is filled only when null and ≥ the highest logged page, and otherwise
    skipped without error;
  - an invalid detail value (blank title, 0 pages, an `http:` cover) is skipped, and
    the status still becomes `ok`.
- [X] T027 [P] [US2] Add a property test, `packages/core/test/decide.fillDetails.property.test.ts`,
  for invariant 6. Run 500 seeded sequences mixing `EditBook` (random fields),
  `FillDetails(found, random details)` and `FillDetails(notFound)` on a pending
  ISBN-placeholder book. Assert that a field set by `EditBook` to a non-empty value is
  never changed by any later `FillDetails`.
- [X] T028 [P] [US2] Write `e2e/offline-scan.spec.ts`, using the T016 fixtures, for
  quickstart scenarios 5, 6 and 7:
  - **(5)** Set `context.setOffline(true)`, then scan and save two books with empty
    titles:
    - **A**: `9780593135204`;
    - **B**: `9781250301697`.

    Both appear as "ISBN …" with a **Details pending** badge, and the confirmation
    showed "Details will be looked up when you're online" immediately.

    Then open B → **Edit** → type the author "A. Michaelides (typed)" → Save. That
    marks B complete, per data-model.md.

    Then `setOffline(false)` and reload. After the retry:
    - A is "Project Hail Mary" by Andy Weir, with the fixture page count and no badge;
    - B keeps its typed author and its placeholder title, and `catalog.requests()`
      shows no lookup for B's ISBN.

    Together these show that the retry never overwrites user edits (FR-009).
  - **(6)** `catalog.miss('9791299999991')` plus a GB `totalItems: 0`: "Not found in
    book catalogs". Save with a typed title, and the badge reads "Details not found".
    Reload: `catalog.requests()` shows **no** new lookup for that ISBN.
  - **(7)** `catalog.delay(9000)`: after 8 s the status reads "Taking too long —
    continue without details". Save gives Details pending.

### Implementation for User Story 2

- [X] T029 [US2] Implement `FillDetails` in `packages/core/src/decide.ts` exactly as in
  contracts/commands-002.md. Make T026 and T027 pass.
- [X] T030 [US2] Handle every lookup outcome in the add flow, in
  `apps/pwa/src/screens/AddBook.svelte` and `apps/pwa/src/lib/isbnFlow.ts`:

  | Outcome | Status line | Saved as |
  |---|---|---|
  | offline or unavailable | "Details will be looked up when you're online." | `detailsStatus: 'pending'` |
  | timeout (8 s) | "Taking too long — continue without details." | pending |
  | notFound | "Not found in book catalogs — add the details yourself." | `notFound` |
  | found | "Found in <source>" | `complete` |

  - The title field may stay empty only when an ISBN is present; the placeholder
    comes from `decide()`.
  - Don't disable **Save** while the lookup is running. Saving before the lookup
    resolves counts as pending.
- [X] T031 [US2] Create `apps/pwa/src/lib/detailsRetry.ts`, following research R8:
  - `runDetailsRetry()`:
    1. Query `pendingDetails`.
    2. Look up at most 2 at a time, skipping ids in a module-level `attempted` Set.
    3. `found` → dispatch `FillDetails(found, details)`, then `fetchCover` →
       `storeCover` if a `coverUrl` was applied.
    4. `notFound` → dispatch `FillDetails(notFound)`.
    5. `unavailable` or `timeout` → nothing.
  - Call it from `apps/pwa/src/App.svelte` once `dbReady` becomes true, and on
    `window` `online`.
- [X] T032 [US2] Show the details status on `Home.svelte`, `Library.svelte` and
  `BookDetail.svelte`: a small badge "Details pending" or "Details not found", driven
  by `BookCard.detailsStatus`. The edit form's Save
  (`apps/pwa/src/screens/AddBook.svelte`, edit mode) sends
  `detailsStatus: 'complete'` (data-model.md "Any explicit user save in the edit form
  marks the book complete").

**Checkpoint**: US1 and US2 pass. This is the MVP: scanning with or without a network.

---

## Phase 5: User Story 3 - Find a book by title (Priority: P2)

**Goal**: search by title, pick an edition, and get the filled-in confirmation.

**Independent Test**: searching "left hand of darkness" lists Le Guin's novel; picking
it gives the filled-in confirmation.

- [X] T033 [P] [US3] Test and implement `apps/pwa/src/catalog/titleSearch.ts`
  (`searchTitle`), with tests in `titleSearch.test.ts`, following
  contracts/catalog-lookup.md, requests #4 and #5:
  - the `ol-search-q-left-hand.json` fixture gives at most 20 hits with title,
    authors, year, and a cover URL from `cover_i`;
  - `isbn` is the first 13-digit entry that passes `parseIsbn`, else null;
  - OL failing (500) plus GB succeeding → GB results;
  - OL returning an empty list → `results: []` (no GB call);
  - offline → `unavailable` with no fetch;
  - timeout;
  - a query shorter than 3 characters is never sent.
- [X] T034 [P] [US3] Write `e2e/search.spec.ts`, covering quickstart scenario 9 and
  US3 · 3:
  - search → the list shows "The Left Hand of Darkness · Ursula K. Le Guin · 1969";
    picking it gives the filled-in confirmation, and Save stores the ISBN;
  - no results → "No matches" and an **Add manually** button, which carries the query
    into the title field;
  - offline → the message plus **Add manually**.
- [X] T035 [US3] Create `apps/pwa/src/screens/Search.svelte` with route `#/search`:
  - a search field (at least 3 characters) submitted with Enter or a Search button;
  - a results list with `Cover.svelte` thumbnails, title, authors and year;
  - picking a hit sets the draft to `{ source: 'search', isbn, lookup: 'found', details }`.
    If the hit has an ISBN, it runs the duplicate check through `startIsbnFlow`'s
    duplicate branch, but does **not** re-run the lookup;
  - the empty, error and offline states.

  Enable the **Search by title** link in `AddBook.svelte`.

---

## Phase 6: User Story 4 - Type an ISBN by hand (Priority: P3)

**Goal**: when there is no camera, enter or paste an ISBN and get the same lookup.

**Independent Test**: with the camera denied, entering `0-441-47812-3` stores
`9780441478125` and looks it up.

- [X] T036 [P] [US4] Write `e2e/isbn-entry.spec.ts`, covering quickstart scenarios 3
  and 4:
  - `fakeCamera.deny()` → Scan shows "Camera permission was denied" plus **Enter
    ISBN**; the field accepts `0-441-47812-3`, the lookup runs for `9780441478125`
    (check `catalog.requests()`), and Save stores the normalized ISBN;
  - an invalid ISBN `9780441172718` shows "That isn't a valid ISBN — check the digits."
    and sends no request.
- [X] T037 [US4] *(As built: a separate `#/isbn` screen, `EnterIsbn.svelte`, instead of a mode inside AddBook.)* Add an **Enter ISBN** mode to `apps/pwa/src/screens/AddBook.svelte`
  (route `#/add?isbn`, or a local toggle):
  - a text input with `inputmode="text"` and `autocomplete="off"`;
  - `parseIsbn` validation runs in the UI for an instant inline error (the same
    parser `decide()` uses);
  - on a valid ISBN, call `startIsbnFlow`.

  Enable the link on the Add screen, and point the Scan screen's denied/unavailable
  button at it.

---

## Phase 7: User Story 5 - Refresh details for an existing book (Priority: P3)

**Goal**: add an ISBN to a book already in the library, look it up, and choose which
fetched fields to apply.

**Independent Test**: edit a manual book, enter its ISBN, **Look up details**, apply
only the page count; nothing else changes and the history is untouched.

- [X] T038 [P] [US5] Write `e2e/refresh.spec.ts`, covering quickstart scenario 11:
  - add "Dune" by hand with no pages and log one entry;
  - Edit → ISBN `9780441172719` → **Look up details**, which shows a comparison list:
    each field with its current value → the fetched value, and a checkbox, all
    unchecked by default;
  - check only "Total pages", then Save. The pages are updated; title, author and
    genre are unchanged; the history still has its entries; the cover is stored only
    if "Cover" was checked.
- [X] T039 [US5] Extend the edit mode of `apps/pwa/src/screens/AddBook.svelte`:
  - an ISBN field (validated with `parseIsbn`), and a **Look up details** button that
    calls `lookupIsbn`;
  - render the comparison list;
  - Save dispatches `EditBook` with the edited fields plus the checked fetched fields,
    the `isbn`, and `detailsStatus: 'complete'`. When "Cover" was applied, run
    `fetchCover` → `storeCover`;
  - on lookup outcomes other than found, show the T030 status line.

---

## Phase 8: Polish & Cross-Cutting

- [X] T040 [P] Write `e2e/covers-offline.spec.ts`, covering quickstart scenario 12:
  scan and save Dune (cover stored), `setOffline(true)`, reload, and the Home card's
  cover `<img>` has `naturalWidth > 0` and a `blob:` src. Then remove the book, and
  `query cover` returns null. Check the latter through the UI: re-adding the same ISBN
  by hand shows the generated initials cover, not the old image.
- [X] T041 [P] Create `apps/pwa/scripts/catalog-coverage.ts` and
  `apps/pwa/scripts/reference-isbns.json`, with the script
  `"catalog:coverage": "node --experimental-strip-types scripts/catalog-coverage.ts"`
  in `apps/pwa/package.json`.
  - The list has 20 ISBNs: 10 popular English and 10 popular Spanish books, from 2015
    to 2025. Every entry must pass `parseIsbn`; the script validates this first.
  - The script runs `lookupIsbn` sequentially with real `fetch`, and prints a table
    plus the totals "title+author: N/20, pages: M/20".
  - **Not** part of `pnpm test` or CI. It is run manually, for SC-002.
- [X] T042 [P] Update the performance check in `e2e/perf.spec.ts`: assert that the
  initial load of `/` does **not** request `zxing_reader.wasm`, checked through the
  page's `requestfinished` URLs. Cold start stays under 1.5 s.
- [X] T043 **(main session)** Update `docs/architecture.md`: §8 "Add a book" (scan,
  search and ISBN flows, pending and retry, covers cache) and §6 (schema v2, `covers`).
  Record the results in the quickstart "Validation results" section, including the
  manual `catalog:coverage` output.
- [X] T044 **(main session)** Run the full quickstart: `pnpm install --frozen-lockfile`,
  `typecheck`, `lint`, `test`, `build`, and `CI=true pnpm e2e`, twice with
  `--repeat-each=2`. Then review the combined diff against the contracts and the
  constitution, and commit.

---

## Phase 9: User Story 6 - Own Google Books key (Priority: P2, amendment 2026-09-29)

**Goal**: an optional per-device Google Books key, stored locally, used only for Google
requests, sending only the site origin as the referrer. See spec US6, FR-017 to FR-019,
and research R14.

**Independent Test**: with a key saved in Settings, an ISBN that Open Library misses
is found through Google, and the request carries `key=` and an origin-only
`Referer`.

- [ ] T045 [P] [US6] Write tests first, in `apps/pwa/src/catalog/googleKey.test.ts` and
  in additions to `isbnLookup.test.ts` and `titleSearch.test.ts`. Follow
  contracts/catalog-lookup.md "Google Books key":
  - with a key, the Google URL ends with `&key=<encoded>` and its init has
    `referrerPolicy: 'strict-origin'`, while OL requests stay `no-referrer`;
  - with no key, or an empty one, the Google URL and init are identical to today's;
  - a keyed 403 or 400 gives `unavailable` with `keyRejected: true`, never
    `notFound`;
  - every `testGoogleKey` branch;
  - the key string never appears in any returned outcome
    (`JSON.stringify(outcome)` doesn't contain it).

  Add fixtures `gb-400-invalid-key.json` and `gb-403-referer.json` with the real
  Google error-body shapes (`error.errors[0].reason` values `badRequest` or
  `keyInvalid`, and `API_KEY_HTTP_REFERRER_BLOCKED` in `error.details` or the
  message).
- [ ] T046 [US6] Implement the key plumbing in `apps/pwa/src/catalog/` (request
  helper, `isbnLookup.ts`, `titleSearch.ts`, and a new `googleKey.ts` for
  `testGoogleKey`). `cover.ts` must NOT receive the key, making T045 pass.
- [ ] T047 [US6] Store the key on the device. It must stay in the local settings table
  only: never in `change_log`, export, or logs.
  - Add `apps/pwa/src/lib/settings.svelte.ts`, holding `settings.googleBooksKey`
    (`$state`). It loads once at startup through a new worker query
    `{ name: 'setting', key: 'google_books_api_key' }`, which returns the value or
    null. Allow-list only that key in the worker.
  - Saving uses the existing `setMeta`. Removing sets `''`; empty means "no key".
  - Pass `googleApiKey: settings.googleBooksKey` into every `lookupIsbn` and
    `searchTitle` call site: `isbnFlow.ts`, `detailsRetry.ts`, `Search.svelte`, and the
    AddBook edit lookup. Never pass it to `fetchCover`.
- [ ] T048 [US6] Add a section "Google Books API key (optional)" to
  `apps/pwa/src/screens/Settings.svelte`:
  - a password-type input labelled "Google Books API key", with **Save**, **Test
    key**, and **Remove**;
  - when saved, show `••••` plus the last 4 characters;
  - `testGoogleKey` results shown in `role="status"` with the exact messages from
    spec US6 · 2;
  - one line of help: "Restrict the key to the Books API and to this website's
    address."

  In `AddBook.svelte`, when the lookup outcome has `keyRejected`, add the line
  "Google Books key was rejected — check Settings."
- [ ] T049 [P] [US6] Write `e2e/google-key.spec.ts` using the catalog harness. Extend
  `e2e/fixtures/catalog.ts` so googleapis routes serve `gb-isbn-9789871544059.json`
  for that ISBN. Create that file by hand from the Google volumes schema: title "After
  Dark", author "Haruki Murakami", publisher "Tusquets", pageCount **null**, since it
  is unknown. The harness must record request headers. Scenarios:
  - **(a)** Save a key in Settings; "Test key" gives "Key works".
  - **(b)** Scan `9789871544059`, which misses in Open Library. The Add screen fills
    in "After Dark" / "Haruki Murakami". The recorded Google request URL contains
    `key=`, and its `referer` header equals the site origin plus `/`, with no path or
    hash.
  - **(c)** Remove the key, scan again (Add another copy): the Google request has no
    `key=` and no `referer`.
  - **(d)** `catalog.fail('googleapis', 403)` with a key gives "Google Books key was
    rejected — check Settings.", and the book saves as pending.
  - **(e)** The key string never appears in the page's `document.body.innerText`,
    except masked.
- [ ] T050 **(main session)** Review, run the full validation, update the quickstart
  (key setup steps and the US6 results), then commit.

## Dependencies & Execution Order

- **Setup (T001–T002)** comes first. T002 can run in parallel with T001.
- **Foundational (T003–T016)** blocks every story.
  - The tests T003–T006 can run in parallel.
  - T007 comes before T008, then T009. T010, then T011, then T012 and T013. T014
    comes after T013.
  - T015 and T016 can run in parallel with the core and db work; they depend only on
    T001 and T002, plus T007 for `parseIsbn`.
- **US1 (T017–T025)** comes after Foundational. T019 and T025 can run in parallel with
  T020 and T021. T022 comes before T023 and T024.
- **US2 (T026–T032)** comes after US1, because it reuses the flow and the Add screen.
  T026, T027 and T029 (core) can start right after Foundational.
- **US3 (T033–T035)** comes after US1 (draft and Add screen). **US4 (T036–T037)** also
  comes after US1. **US5 (T038–T039)** comes after US1 and US2 (the outcome lines and
  `detailsStatus`).
- **Polish (T040–T044)** comes after all stories.

## Parallel batches (for delegating to implementer agents)

```text
Batch A (after T001/T002): T003, T004, T005, T006 — tests (4 agents, different files)
Batch B: T007 → T008 → T009 (core, one agent)  ‖  T010 → T011 → T012 → T013 → T014 (db+worker, one agent)  ‖  T015 (catalog, one agent)  ‖  T016 (e2e harness, one agent)
Batch C (US1): T017+T019 (one agent) ‖ T020+T021 (one agent) ‖ T025 (one agent); then T022 → T023 → T024 + T018 (one agent)
Batch D: T026, T027, T029 (core agent) ‖ T028 → T030 → T031 → T032 (pwa agent)
Batch E: US3 (T033–T035) ‖ US4 (T036–T037) — different files except AddBook.svelte links; serialize the AddBook edits
Batch F: US5 (T038–T039), then Polish T040–T042 in parallel
```

## Implementation Strategy

1. **MVP**: Setup, then Foundational, then US1 (scan) and US2 (offline and pending).
   That is the first version worth installing, since scanning works with or without a
   network.
2. **Increment**: US3 (search), then US4 (enter ISBN), then US5 (refresh), then Polish.
3. Commit at every checkpoint. Only the main session commits, after review
   (CLAUDE.md).
