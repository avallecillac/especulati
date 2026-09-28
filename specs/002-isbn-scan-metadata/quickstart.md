# Quickstart & Validation: ISBN Scan & Book Metadata Lookup (002)

## Prerequisites

The same as 001: Node 22, pnpm 10, and Chromium, which is preinstalled in the dev
container.

## Automated checks

```bash
pnpm install
pnpm typecheck && pnpm lint
pnpm test          # core (parseIsbn, AddBook/EditBook/FillDetails), db (migration 2, covers, queries), pwa (catalog parsers with fixtures)
pnpm e2e           # catalogs and covers intercepted with page.route; camera replaced by a canvas stream (research R4)
```

Expected: everything exits 0, and no request leaves for `openlibrary.org` or
`googleapis.com` during `pnpm e2e`. Assert this in a fixture that fails the test on any
unrouted request to those hosts.

## Scenarios

| # | Scenario | Covers | How |
|---|---|---|---|
| 1 | Scan an EAN-13 book barcode: a filled-in confirmation (title, author, pages, genre, cover), then save, and it is the current book with its cover | US1, SC-001 | e2e `scan.spec.ts` (canvas camera, routed catalogs) |
| 2 | A UPC or `9790` barcode is ignored; after 10 s, "Enter ISBN" is suggested | FR-002, edge case | e2e (clock) |
| 3 | Camera permission denied: the reason is shown, plus **Enter ISBN** | US4 · 1 | e2e (`getUserMedia` rejects `NotAllowedError`) |
| 4 | Enter `0-441-47812-3`: stored as `9780441478125` and looked up | US4 · 2, FR-003 | core + e2e |
| 5 | Offline scan and save: the title is "ISBN 978…", marked Details pending; back online plus a reload fills it in without overwriting a typed author | US2 · 1–3, FR-009, SC-003 | e2e `offline-scan.spec.ts` |
| 6 | The catalogs answer "no match": "Not found in book catalogs", saved as notFound, never retried | US2 · 4 | e2e |
| 7 | The catalog is slow (routed delay of 9 s): **Continue** after 8 s, and the book is pending | US2 · 5, SC-004 | e2e |
| 8 | A Google 429 while Open Library misses: stays **pending**, not notFound | research R2 | pwa unit |
| 9 | Title search "left hand of darkness": the list, then pick, then the filled-in confirmation | US3 | e2e with fixture |
| 10 | Scan an ISBN already in the library: **Open existing** / **Add another copy**, and no duplicate is created | FR-012, SC-005 | e2e |
| 11 | Edit a manual book, enter an ISBN, **Look up details**, apply only the page count | US5 | e2e |
| 12 | A cover shows offline after a reload with `setOffline(true)` | SC-006 | e2e |
| 13 | A v1 fixture database migrates to v2 unchanged apart from the new objects | constitution | db unit |
| 14 | Leaving the scan view stops every camera track | FR-014 | e2e (spy on `track.stop`) |

## Manual checks

**Live catalogs (SC-002):** run
`pnpm --filter pwa catalog:coverage`. It looks up the 20 reference ISBNs in
`apps/pwa/scripts/reference-isbns.json` (10 English, 10 Spanish) against the live
catalogs. Expect **18 or more of 20** with a title and author, and **15 or more of 20**
with a page count.

**On an iPhone (iOS 17+, installed web app):**

1. Add → **Scan barcode**, and allow the camera.
2. Point it at a book: it is recognized hands-free within about 2 s, and the preview
   closes.
3. Check the confirmation fields, then **Save**. The book is the current book, with its
   cover. Count the taps: 3 or fewer (SC-001).
4. Turn on airplane mode, then scan and save another book. It shows "ISBN 978…" and
   Details pending.
5. Turn off airplane mode and reopen the app. The details fill in.
6. Force-quit, relaunch offline: the covers still show.
