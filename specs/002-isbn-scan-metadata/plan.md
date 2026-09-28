# Implementation Plan: ISBN Scan & Book Metadata Lookup

**Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `002-isbn-scan-metadata`) | **Date**: 2026-09-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-isbn-scan-metadata/spec.md`

## Summary

This feature adds three ways to find a book's details, all ending in the same
filled-in confirmation screen:

- **Scan the barcode** with the camera, decoded by `zxing-wasm` (reader build,
  self-hosted WASM) in a scanner worker;
- **Enter an ISBN**;
- **Search by title**.

The details come from **Open Library**, with search-by-ISBN and the edition record
queried in parallel, and **Google Books** as a best-effort fallback. The whole lookup has
an 8 s budget and a clear outcome.

Saving never waits on the network:

- An unknown title becomes `ISBN <isbn13>`, and the book is marked **pending**.
- A per-launch retry dispatches the new `FillDetails` command, which only fills fields
  the user left empty.
- Covers are downscaled in the DB worker and kept in a local-only `covers` table
  (schema v2). They are not in `change_log`.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22 for tooling. Unchanged from 001.

**Primary Dependencies**:

- Existing: SQLite-WASM, Svelte 5, Vite 8, vite-plugin-pwa.
- **New runtime dependency**: `zxing-wasm@3.1.4` (reader build, self-hosted `.wasm`,
  research R3).
- **New dev dependency**: `zxing-wasm` full build in `e2e`, for generating test
  barcodes.

**Storage**: SQLite schema **v2**: the partial index `idx_items_isbn` and a
local-cache table `covers`.

**Testing**:

- Vitest:
  - core: `parseIsbn`, placeholder titles, `FillDetails`, and property tests;
  - db: migration v1→v2, covers, queries;
  - **new `pwa` project**: catalog parsers against recorded fixtures.
- Playwright:
  - routed catalogs, with a guard that fails on any unrouted request to them;
  - the camera replaced by a canvas stream, so the real decode path runs.

**Target Platform**: iOS 17+ installed web app, where the rear camera scans. On the
Mac, in Chrome, it's Enter ISBN and search.

**Project Type**: The same monorepo as 001. **No new packages.** Catalog code lives in
`apps/pwa/src/catalog/`, scanner code in `apps/pwa/src/scanner/`.

**Performance Goals**:

- A scan is recognized within about 2 s of the barcode being in frame.
- A lookup reaches an outcome within 8 s (SC-004); Open Library measured 0.4–0.9 s.
- The scanner WASM loads only when the scan view opens, so cold start is unchanged.

**Constraints**:

- The only data sent to catalogs is the ISBN or the query text (FR-013), with
  `credentials: 'omit'` and `no-referrer`.
- The camera is on only while the scan view is open (FR-014).
- Covers stay under 50 MB per 1,000 books (FR-010).

**Scale/Scope**: 5 user stories, 2 new screens (Scan, Search), and changes to Add, Edit
and cards; about 100 books per decade.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Local-first | Saving never depends on the network: placeholder title, pending status, retry per launch (FR-007, FR-009). The scanner WASM is precached, so scanning works offline too. Offline scan and save is tested in e2e (scenario 5). | PASS |
| II. The user owns the data | Catalogs get only the ISBN or query text, with no cookies, referrer or identifiers. Frames are never stored. Covers are a local cache that can be rebuilt from `cover_url`. The new fields travel in `change_log` and the future export. **Note:** a third-party lookup reveals the user's IP and the ISBN to Open Library or Google. It is user-initiated and optional (Principle I lists metadata lookup as an allowed optional call), and a manual path always exists. | PASS |
| III. Events over state | Reading events are untouched. `metadata_status` is catalog provenance, not reading state. | PASS |
| IV. Functional core, imperative shell | `parseIsbn`, the placeholder title, and `FillDetails`'s fill-only-empty rule are pure, in `packages/core`. `fetch`, the camera, the WASM and image encoding live in the shell. Catalog parsers are pure but catalog-specific, so they stay in the shell. The boundary tooling is unchanged. | PASS |
| V. Near-zero friction | Adding a book isn't one of the constitution's primary capture flows. It is still 3 taps plus the scan (SC-001), with auto-detection and no shutter button. | PASS |
| VI. Simplicity | One new runtime dependency, justified in R3/R13. No new packages. Google Books is a fallback only. A user API key and native `BarcodeDetector` are deferred. The `cover_blob_key` column stays unused rather than being migrated away. | PASS |
| VII. Verified correctness | Test-first at every layer: fixture-based parser tests, a property test for invariant 6, a migration fixture test, and e2e for every user story, with third-party hosts blocked. | PASS |
| Tech constraints | No Apple account needed. Migration 2 is forward-only and fixture-tested. Stats performance isn't affected (003). | PASS |

**Post-design re-check (after Phase 1):** PASS.

- The contracts add one command (`FillDetails`), one rejection (`InvalidIsbn`), and five
  db methods and four worker messages, each with a named consumer.
- `covers` is explicitly kept out of `applyChanges`, so the single write path for
  domain data is intact.

## Project Structure

### Documentation (this feature)

```text
specs/002-isbn-scan-metadata/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── commands-002.md        # parseIsbn, AddBook/EditBook additions, FillDetails, invariants 6–8
│   ├── catalog-lookup.md      # lookupIsbn/searchTitle/fetchCover, requests, merge rules, fixtures
│   └── db-and-worker-002.md   # migration 2, db methods, worker + scanner messages
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (changes and additions)

```text
packages/core/src/
├── types.ts            # + Isbn13, parseIsbn, CoverUrl parser
├── book.ts             # Item + isbn, coverUrl, detailsStatus
├── commands.ts         # AddBook/EditBook fields, FillDetails, InvalidIsbn
└── decide.ts           # placeholder title, FillDetails
packages/core/test/     # isbn.test.ts, decide.fillDetails.test.ts (+ property), AddBook/EditBook additions

packages/db/src/
├── migrations.ts       # migration 2
├── snapshot.ts         # rowToItem maps isbn, cover_url, metadata_status
├── covers.ts           # putCover/getCover/deleteCover
└── queries.ts          # BookCard + isbn/detailsStatus/hasCover; findByIsbn; pendingDetails
packages/db/test/       # migration2.test.ts (v1 fixture), covers.test.ts, queries additions

apps/pwa/src/
├── catalog/            # isbnLookup.ts, titleSearch.ts, openLibrary.ts, googleBooks.ts, merge.ts, genre.ts, cover.ts
│   ├── fixtures/       # recorded JSON (contracts/catalog-lookup.md)
│   └── *.test.ts       # Vitest project "pwa"
├── scanner/            # scanner.worker.ts, camera.ts (start/stop, frame loop), isbnFilter.ts
├── lib/detailsRetry.ts # per-launch retry (research R8)
├── worker/db.worker.ts # + findByIsbn, pendingDetails, cover, storeCover; deleteCover after RemoveBook
└── screens/
    ├── AddBook.svelte  # entry actions (Scan / Search / Enter ISBN / Manual) + confirmation mode
    ├── Scan.svelte     # camera view
    ├── Search.svelte   # title search results
    ├── Cover.svelte    # cover image or generated initials cover
    └── BookDetail.svelte / Home.svelte / Library.svelte   # show covers and Details pending/not found; edit: ISBN + Look up
apps/pwa/scripts/       # catalog-coverage.ts + reference-isbns.json (manual SC-002 check)

e2e/
├── fixtures/catalog.ts # page.route handlers + unrouted-host guard + fake camera init script
└── scan.spec.ts, offline-scan.spec.ts, search.spec.ts, isbn-entry.spec.ts, refresh.spec.ts
```

**Structure Decision**: no new workspace packages. The catalog and scanner code are
shell modules of the PWA, their only consumer (Constitution VI). The Vitest config gains
a `pwa` project for their pure parts.

## Complexity Tracking

No constitution violations.
