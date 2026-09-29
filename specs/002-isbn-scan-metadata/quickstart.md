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

## Validation results (2026-09-28, dev container, Chromium 141 headless)

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | ✅ 0 errors, 0 dependency violations |
| `pnpm test` | ✅ 211 tests (core 113 · db 33 · pwa 65) |
| `pnpm e2e` | ✅ 46/46; **92/92** with `--repeat-each=2`. No real catalog calls: the harness guard fails any unrouted request, and a mutation check confirmed the cover-delete test fails when deletion is disabled |
| Scenarios 1–14 | ✅ all automated (scan, search, isbn-entry, offline-scan, refresh, covers-offline, harness) |
| SC-001: Add → saved in ≤ 3 taps | ✅ scan.spec (a) |
| SC-004: an outcome within 8 s | ✅ offline-scan (7), and the unit tests for timeout |
| SC-006: cover offline | ✅ covers-offline.spec |
| Cold start / scanner WASM kept off the startup path | ✅ about 130 ms; `zxing_reader` isn't requested at startup; precache is 2.4 MB, 20 entries |
| **SC-002: live catalog coverage** | ⚠️ **Not yet measured reliably.** `catalog:coverage` from the container gave **13/20** (title+author) and **13/20** (pages). All 10 English ISBNs were found. 7 Spanish ISBNs came back "unavailable": Open Library had no match, and the Google Books fallback got a **429** from the container's shared IP. The Spanish ISBNs were picked without an external check, so some may be wrong editions. **Re-run `pnpm --filter pwa catalog:coverage` on a normal network**, fix any wrong ISBNs in `apps/pwa/scripts/reference-isbns.json`, and record the result here. If Spanish coverage stays below target even with Google working, consider the deferred "user-supplied Google Books API key" option (research R1) |
| Manual iPhone check | ⏳ Pending: needs a device and an HTTPS host |

## US6: Google Books API key (amendment, 2026-09-29)

**Setting up the key** (Google Cloud Console → APIs & Services):

1. Enable the **Books API**.
2. Create an **API key**, then under **Edit API key**:
   - API restrictions: **Books API only**;
   - Application restrictions: **Websites**, with `https://<your-domain>/*` (plus
     `http://localhost:5173/*` if you develop locally);
   - optionally, Books API → Quotas: cap queries per day at about 200.
3. In Readerlog → **Settings → Google Books API key**, paste it, **Save**, then **Test
   key**, which should say "Key works". Repeat on each device. The key never syncs.

**Manual check:** scan `9789871544059`. With the key, the Add screen fills in "After
Dark" / "Haruki Murakami" from Google. Enter the page count by hand, since Google has
none for this edition.

**Validation (dev container):** `pnpm test` 230/230, e2e 51/51 and **102/102** over 2
repeats, typecheck and lint clean.

A mutation check removed the `&key=` append in the request helper: 5 key tests failed,
and all passed again once restored. Tests use only a fake key.
