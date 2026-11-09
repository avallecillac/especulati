# Readerlog — Architecture (v2, local-first)

> This version supersedes the original native-iOS spec (v1). It was revised
> because the owner has no paid Apple Developer account, reads many articles
> in Chrome on a Mac, and wants multi-device sync from the start. Feature-level
> detail lives in `specs/NNN-*/`; project rules live in
> `.specify/memory/constitution.md`.

## 1. Product summary

Readerlog is a **personal, single-user app** for logging books and web articles
and viewing reading stats.

- **It is not a reader.** Readerlog has no in-app reading and never stores article text,
  apart from passages the user explicitly saves as highlights (constitution v1.2.0).
- **Books** are logged through progress updates. These drive the headline stat:
  *reading days per year*.
- **Articles** are logged once, when read. They feed counts and stats only and
  **never** count toward reading days or streaks.
- **Audience:** a single user who owns several devices, currently an iPhone and a Mac.
  There are no accounts, no multi-tenancy, and no social features.

## 2. Guiding principles

1. **Local-first.** Each device holds a full SQLite database and treats it as its
   source of truth. Every read and write is local and works offline. Using the
   network is always optional.
2. **The user owns the data.** Any device can do a lossless export and import.
   The sync relay only ever sees ciphertext.
3. **Minimal backend.** The only server is a tiny relay that stores encrypted
   change batches. It has no knowledge of the domain and no always-on logic.
4. **Book progress is stored as events, not state.** Book progress is an
   append-only event log, which keeps historical stats computable.
5. **Logging takes near-zero effort.** Every capture flow takes at most 2 taps or clicks.

## 3. Platform decision

A native iOS app, whether Swift or Expo, would need a paid Apple Developer
account for App Groups (widgets and share extensions), iCloud containers, and
builds that don't expire every 7 days. Readerlog is therefore:

| Surface | Technology | Role |
|---|---|---|
| **PWA** (iPhone home screen, Mac Chrome) | TypeScript, Vite, Svelte 5, `vite-plugin-pwa` | The full app: library, logging, stats, sync, export |
| **Local DB** | `@sqlite.org/sqlite-wasm`, OPFS SAH-pool VFS, in a dedicated Web Worker | The only persistent store on each device |
| **Chrome extension** (Mac) | Manifest V3 | One-click "Log as read"; reads page metadata from the live DOM; a write-only sync peer |
| **iOS Shortcut** | Shortcuts app, "Run JavaScript on Web Page" | Share-sheet capture from Safari; hands the payload to the PWA's `/capture` route |
| **Relay** | Cloudflare Worker + D1 (free tier) | Stores and forwards encrypted op batches; nothing else |

Accepted losses compared with the native spec:
- There is no home or lock-screen widget. It is replaced by a "Current book" quick-log card on the app's start screen.
- There are no local notification reminders in v1. They would need Web Push from a server cron and are deferred.

## 4. System overview

```
 iPhone                                   Mac
┌──────────────────────────┐     ┌──────────────────────────┐   ┌───────────────────┐
│ PWA (installed)          │     │ PWA (Chrome)             │   │ Chrome extension  │
│  UI ─ core ─ SQLite/OPFS │     │  UI ─ core ─ SQLite/OPFS │   │  popup + content  │
│  change_log ─ sync       │     │  change_log ─ sync       │   │  script; push-only│
└──────▲───────────┬───────┘     └──────▲───────────┬───────┘   └────────┬──────────┘
       │ Shortcut  │ E2E-encrypted ops  │           │                    │
  Safari share     ▼                    │           ▼                    ▼
               ┌──────────────────────────────────────────────────────────┐
               │ Relay (Cloudflare Worker + D1): append/pull ciphertext   │
               └──────────────────────────────────────────────────────────┘
  Book metadata: Open Library → Google Books (called directly from the PWA; both allow CORS)
```

## 5. Code architecture: functional core, imperative shell

```
packages/core   pure TS: branded types, decide(), HLC, merge rules, interchange v1, stat math
packages/db     SQLite schema + migrations, repositories, stats SQL (browser worker + Node tests)
packages/sync   HKDF keys, AES-GCM envelopes, relay client, push/pull loop
apps/pwa        Svelte UI, DB worker, service worker, barcode scanner, /capture route
apps/extension  Chrome/Brave MV3 extension: Readability extractor, toast, push-only capture peer (no SQLite)
apps/relay      zero-knowledge relay handler (+ functions/ = Cloudflare Pages Functions adapter, D1)
shortcuts/      iOS Shortcut + JS snippet + install guide
e2e/            Playwright scenarios
```

- `packages/core` never touches the DOM, SQLite, `fetch`, the clock, or
  randomness. The shell passes in `now` and new IDs. CI enforces this boundary.
- Every mutation follows one path:
  1. `decide(state, command, now) → Result<Change[], Rejection>`. New IDs are generated
     by the shell and carried inside the command.
  2. The shell applies all the `Change[]` in **one SQLite transaction**. That
     transaction writes rows, advances `field_clock`, and appends to `change_log`.
- Types follow "parse, don't validate": `ItemId`, `LocalDate`, `Page`,
  `NonEmptyTitle`, and so on are branded and built only through smart constructors.

## 6. Data model (schema v5)

```sql
CREATE TABLE items (
  id              TEXT PRIMARY KEY,          -- UUID
  type            TEXT NOT NULL CHECK (type IN ('book','article')),
  title           TEXT NOT NULL,
  author          TEXT,
  isbn            TEXT, total_pages INTEGER, genre TEXT,
  cover_url       TEXT, cover_blob_key TEXT, -- books
  url             TEXT, domain TEXT, word_count INTEGER,
  read_on         TEXT,                      -- articles: local YYYY-MM-DD
  metadata_status TEXT NOT NULL DEFAULT 'ok' CHECK (metadata_status IN ('pending','ok','failed')),
  rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
  created_at      TEXT NOT NULL,             -- UTC ISO-8601
  deleted_at      TEXT                       -- tombstone
);

CREATE TABLE reading_events (              -- books only; insert-only except tombstone
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id),
  event_type  TEXT NOT NULL CHECK (event_type IN ('started','progress','finished','abandoned')),
  page        INTEGER,                     -- NULL = "read today" without a page
  occurred_at TEXT NOT NULL,               -- UTC ISO-8601
  local_date  TEXT NOT NULL,               -- YYYY-MM-DD as experienced by the user
  deleted_at  TEXT
);

CREATE TABLE tags      (id TEXT PRIMARY KEY, name TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE item_tags (item_id TEXT NOT NULL, tag_id TEXT NOT NULL, deleted_at TEXT,
                        PRIMARY KEY (item_id, tag_id));

-- sync bookkeeping
CREATE TABLE field_clock (tbl TEXT, row_id TEXT, field TEXT, hlc TEXT NOT NULL,
                          PRIMARY KEY (tbl, row_id, field));
CREATE TABLE change_log  (seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE NOT NULL,
                          hlc TEXT NOT NULL, device_id TEXT NOT NULL, tbl TEXT NOT NULL,
                          row_id TEXT NOT NULL, fields_json TEXT NOT NULL,
                          pushed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE meta        (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- device_id, hlc, cursors
```

The spec's indexes are kept (`reading_events(item_id, local_date)`,
`reading_events(local_date)`, `items(type, read_on)`), as partial indexes with
`WHERE deleted_at IS NULL`.

**Rules**
- Book status is **derived** from the latest non-deleted event, never stored:
  - no events → queued
  - `started` or `progress` → reading
  - `finished` → done
  - `abandoned` → abandoned
- `local_date` is **explicit**. It is captured from the device's timezone at
  write time, or set by hand when backdating. It is never derived from UTC at
  query time.
- `page` is optional. A page-less event counts as a reading day but is ignored
  by pace calculations. A book may have several events on the same day.
- Articles have no events. For an article, `read_on` is the whole log.
- A correction never rewrites an event. It tombstones the event and inserts a
  replacement.

**Migration 2 (feature 002)** adds
`idx_items_isbn ON items(isbn) WHERE deleted_at IS NULL AND isbn IS NOT NULL`, plus a
**local-only** cache table
`covers(item_id PK, mime, bytes, width, height, fetched_at)`.
`items.metadata_status` holds the details status: `ok` (complete), `pending`, or
`failed` (not found). `cover_blob_key` is unused; it was superseded by `covers`.

**Migration 3 (feature 004)** adds:
- the synced table `duplicate_dismissals(id, item_a, item_b, created_at, deleted_at)`,
  holding "Keep both" decisions;
- the synced column `items.merged_into`, set on a book merged away;
- the **local-only** inbox `sync_inbox`, holding remote ops that arrived before their
  row.

**Migration 4 (feature 007)** adds the synced table
`highlights(id, item_id, quote, note, page, created_at, local_date, deleted_at)`:
- `quote` and `note` are each at most 5,000 characters, and at least one is set;
- `page` is for books, later;
- removal is a tombstone.

Only text the user explicitly selects is stored (constitution v1.2.0). The migration
also resets `sync_cursor` and the "couldn't be read" counter, so a device re-reads
the space once after updating (see §7).

**Migration 5 (feature 008)** does three things:
- **Saved articles:** `type = 'article'` rows with `read_on IS NULL`. The saved date is
  `created_at`, and the partial index `idx_items_saved` serves the list.
- **Tags:** `tags(id, name, name_key, created_at, deleted_at)` and
  `item_tags(id, item_id, tag_id, created_at, deleted_at)` are rebuilt as synced tables.
  Ids are derived from `name_key`, and assignment ids from `(item, tag)`, so devices
  converge without a merge step. Tags are for articles only; books will get shelves
  later.
- **Re-read:** it resets the cursor once, as migration 4 did.

Every read-article list, stat and lookup excludes saved articles.

Sync state lives in `meta` (`sync_key`, `sync_cursor`, `pending_batch`, `sync_status`,
`sync_old_space`), which is never synced.

## 7. Sync (v1)

- **Merge semantics**
  - **Fields** use last-writer-wins per `(table, row, field)`, comparing HLCs
    (hybrid logical clocks).
  - **Events** merge by union on `id`.
  - **Tombstones** are ordinary fields, so they also follow LWW.
- **HLC format:** `<unix-ms, 13 digits>-<counter, 4 digits>-<device_id>`. Plain
  string comparison gives the correct total order.
- **Space and keys**
  - The first device generates a 256-bit secret `K`.
  - HKDF derives `spaceId`, `authToken`, and `encKey` from `K`.
  - Another device pairs by scanning a QR code of `K` or pasting it as a code.
  - A "full reset" creates a **new** space. Peers never merge a replaced dataset back in.
- **Push:** each device batches its unpushed `change_log` rows, encrypts them with
  AES-GCM, and sends `POST /spaces/:spaceId/ops`. The relay assigns
  `server_seq`, and a duplicate `op_id` is a no-op.
- **Pull:** `GET /spaces/:spaceId/ops?after=<cursor>`. The device decrypts the
  batch and applies it in a single transaction.
- **When sync runs:** on app open, on `visibilitychange`, after writes (debounced),
  and when `online` fires. A device that is offline keeps working fully.
- **Chrome extension:** a push-only peer that creates article items and highlights.
- **Batch tiers (007):** a pushed batch never mixes `highlights` ops with other tables
  (`tierOf` in core).
  - A device on an older version rejects a whole batch that names an unknown table,
    and moves past it. With single-tier batches, it skips only highlights and never
    loses article or book ops.
  - After it updates, migration 4 makes it re-read the space; ops it already has are
    ignored by `op_id`.
  - A future table must follow the same rule: give it its own tier.
- **More tiers (008):**
  - `tierOf(tbl, fields)` puts `tags` and `item_tags` in the `t` tier, and any `items`
    op setting `read_on: null` (a saved article) in the `s` tier. 0.8.0 reads `read_on`
    strictly and would break on a saved row.
  - `MarkArticleRead` and the reconcile survivor carry the **full article row**, so an
    old device that never saw the saved copy receives a complete read article.
- **Reconcile (008):**
  - **What it fixes:** the push-only extension can't see saves made on other devices,
    so a saved URL logged elsewhere becomes two articles.
  - **What it does:** after sync and after local writes, the PWA merges each
    saved/later-read (or saved/saved) pair with `ReconcileSavedArticle`. The kept copy
    is the saved one, with the read date, the highlights and the tags carried over.
  - **Safety:** it's deterministic, with derived ids, so every device makes identical
    changes.
- **As designed in 004** (`specs/004-encrypted-sync/`):
  - The relay runs as Cloudflare **Pages Functions** on the same origin
    (`/api/v1`), with D1. It stores opaque encrypted **batches** of ops, keyed by a
    random batch id.
  - Ops that arrive before their row exists wait in a local `sync_inbox`.
  - After joining, likely duplicate books can be merged. The earliest-added copy
    survives, and entries are copied onto it with deterministic ids.

## 8. Capture flows

### Add a book (feature 002)
Details: `specs/002-isbn-scan-metadata/`.

1. **Getting an ISBN.** There are three entry points, and each ends on the same
   filled-in Add screen:
   - **Scan barcode** (`#/scan`): the camera feeds a scanner worker that runs
     `zxing-wasm` (reader build). The WASM is self-hosted and precached, and it is
     loaded only when the scanner opens. Only EAN-13 with prefix 978, or 979 but not
     9790, is accepted.
   - **Enter ISBN** (`#/isbn`).
   - **Search by title** (`#/search`).
2. **Duplicates.** A book already in the library, matched by its normalized ISBN,
   offers **Open existing** or **Add another copy** before any lookup runs.
3. **Lookup.** Open Library search-by-ISBN and the edition record are queried in
   parallel. Google Books is a fallback only; its anonymous quota is unreliable.
   - One 8 s deadline covers the whole lookup.
   - Outcomes: `found`, `notFound` (every catalog answered "no"), `unavailable`,
     or `timeout`.
   - Requests carry only the ISBN or the query text, with no cookies or referrer.
4. **Saving never waits.** Unknown details save as **pending**, and a blank title
   becomes `ISBN <isbn13>`.
   - `detailsRetry` retries once per launch, and again when the device comes back
     online if the earlier attempt never reached the network.
   - It uses `FillDetails`, which only fills fields that are still empty, and only
     while the book is pending. Any user save marks the book complete, so a user
     edit is never overwritten.
5. **Refreshing an existing book.** On the edit screen, add an ISBN, choose **Look
   up details**, and pick which fetched fields to apply.
6. **Covers.** The DB worker downscales each cover to at most 480 px tall (JPEG
   q0.75) and stores it in the local `covers` table. That table is **not** in
   `change_log` and is not synced; it can always be rebuilt from `cover_url`. Books
   without a cover show generated initials.

### Log book progress (the most frequent action)
- The app opens on a **Current book** card with a one-tap log.
- The page field is pre-filled with the last logged page.
- **"Read today"** adds a `progress` event with `page = NULL`.
- Today is selected by default, and **Yesterday** is one tap away for backdating.
- Reaching `total_pages` asks **"Mark as finished?"**.

### Log an article
- **Mac (Chrome extension):** the user clicks the toolbar button, uses the
  keyboard shortcut, or right-clicks and picks **Log as read**. A content script
  collects the URL, title, author, and a readability-style word count from the
  live DOM, so it also works on paywalled or logged-in pages. The article is
  saved with `read_on = today` in the Mac's local timezone.
- **iPhone (Chrome share sheet → Readerlog Shortcut), feature 005:**
  - Chrome on iOS shares only the URL. The Shortcut fetches the page's readable
    version itself and opens `https://<app>/#/capture?d=<base64 JSON>` in **Chrome**,
    the default browser.
  - iOS home-screen apps have isolated storage and can't receive links, so
    **Readerlog in Chrome on the iPhone is paired as its own sync device**. It saves
    the capture and pushes it at once, and the home-screen app receives it on its next
    sync.
  - Safari is not supported.
- **Mac (Chrome or Brave extension), feature 005:** a push-only sync peer with no
  SQLite. It never pulls the log.
- Sharing an article counts as reading it; there is no queue.

### Save a highlight (feature 007)
- **Mac:** select text, then press **Alt+Shift+H** or right-click → **Save highlight
  to Readerlog**.
  - Only the selection is read, through the existing on-click access.
  - An article that isn't logged yet is logged in the same step, and one Undo removes
    both.
  - The toast offers **Add note**.
- **iPhone:** select, **Copy**, then **Share → Highlight in Readerlog**. The Shortcut
  adds the clipboard as `quote` to the capture link.
- **In the app:** **Add highlight** or **Add note** on any article.
- **Jump back:** tapping a quote opens the article at the passage, through a text
  fragment derived from the quote. No anchor text is stored.
### Save for later, tags and search (feature 008)
- **Save:**
  - **Mac:** **Alt+Shift+S**, or right-click → **Save for later** (on a link it saves
    the URL only).
  - **iPhone:** a capture link with `later: 1`, through the "Save to Readerlog"
    Shortcut.
  - **In the app:** **Read later** in Add article.
- **Read:**
  - **Mark as read**, with Undo.
  - Logging or highlighting a saved URL marks it read on every path.
  - **Remove** has Undo everywhere, through `RestoreArticle`.
- **Tags:**
  - chips with suggestions;
  - **All tags…** to rename (merging into an existing name) or delete;
  - **Add tags** after capture.
- **Search:** an in-memory index in the worker, with accents folded. It covers titles,
  authors, sites, tags, highlight quotes and notes, with an AND tag filter. With 5,000
  articles, the first search takes about 70 ms and later ones about 1 ms.
- A URL typed in by hand keeps only its domain, because a browser can't fetch
  arbitrary pages due to CORS. Its status is `metadata_status = 'failed'`.

## 9. Stats (on-device)

The headline stat is **reading days per year**. It counts books only.

**How stats are computed:**
- One query loads every live event of every live book.
- Pure functions in `packages/core/src/stats.ts` compute each stat. See
  `specs/003-reading-stats/` for the full rules.

| Stat | Source |
|---|---|
| Reading-day heatmap | distinct `local_date`s of `started`, `progress` and `finished` events. A bare `abandoned` doesn't count; abandoning at a page adds a `progress` event |
| Current and longest streak | consecutive reading days. The current streak survives until the end of today |
| Books finished per month and year | `finished` events, one per read-through |
| Pages read per period | per read-through, each page minus the highest page so far. The first page counts in full only if the read-through began with `started` |
| Pages per reading day | pages read ÷ reading days |
| Average days to finish | a read-through's first event → `finished`, both days counted |
| Abandon rate, overall and by genre | current status: abandoned ÷ (finished + abandoned) |
| Pace and estimated finish | pages in the last 14 days of the open read-through ÷ days |
| Articles per week and month (005) | `items.read_on` where `type = 'article'` |
| Estimated article reading time (005) | `SUM(word_count) / 238` wpm |
| Top authors, genres, and domains | grouped counts |

Streaks and reading days count books only. Article stats have their own section.

## 10. Backup and portability

- The relay holds the complete encrypted change log, so pairing a new device restores everything.
- **Export** produces `readerlog/v1` JSON (a hand-written, versioned data
  transfer object that rejects unknown versions) and CSV. The raw SQLite file
  can also be downloaded.
- **Import** merges by `id`. It is idempotent and never returns a partial result.

## 10a. Themes (feature 006)

Colours live only in `apps/pwa/src/theme/`; screens use tokens (`--paper`, `--ink`, `--accent`, ...). A
theme is a palette, nothing more.

### Adding a theme

1. Copy `apps/pwa/src/theme/macondo.css` to `<id>.css` and change the values. It must set exactly the
   contract tokens (`specs/006-illustrated-edition-ui/contracts/theme-tokens.md`) inside one
   `:root[data-theme='<id>']` rule. `theme-tokens.test.ts` checks this, and
   `test-fixtures/test-theme.css` is the test-only proof that a CSS file alone is enough.
2. Import the file in `apps/pwa/src/main.ts` next to the other theme CSS, and add an entry to `THEMES` in
   `src/theme/themes.ts` (`id`, `name`, `scheme`, `swatch` = paper, accent, ornament, and `themeColor` =
   the bar colour). The tests check that `swatch` and `themeColor` equal the CSS values, and
   `theme-contrast.test.ts` checks the WCAG pairs.
3. Update the **pre-paint script in `apps/pwa/index.html`**. It runs before any module loads, so it hard-codes
   the theme ids and the `theme-color` values, and cannot import `THEMES`. `prepaint.test.ts` runs that
   script against the registry and fails if it disagrees. The manifest colours come from the default theme.

The picker in Settings builds its rows from `THEMES`, so it needs no change.

## 11. Out of scope (v1)

- In-app reading, and storing article text beyond explicitly saved highlights
- Accounts and auth, beyond the pairing key
- Social features
- Home-screen widgets and push reminders, deferred
- AI features

## 12. Feature roadmap (spec-kit)

| # | Feature | Summary |
|---|---|---|
| 001 | local-book-log | Monorepo, core + db, PWA shell (offline/installable), manual book add, progress logging, current-book card |
| 002 | isbn-scan-metadata | Barcode scan, Open Library → Google Books, title search, offline covers |
| 003 | reading-stats | Book stats + heatmap/streaks; separate article stats |
| 004 | encrypted-sync | Relay, pairing (QR/code), push/pull, LWW merge, convergence tests |
| 005 | article-capture | iOS Shortcut + `/capture`, Chrome extension |
| 006 | illustrated-edition-ui | Native-iOS shell (large titles, translucent tab bar, push/pop), illustrated-edition look (EB Garamond/Cormorant, ornaments, cloth covers), token-based themes: Macondo, Patriarca, Automatic |
| 007 | highlights-notes | Save passages and notes on articles: Mac extension (menu + shortcut), iPhone Shortcut (Copy → Share), by hand in the app; synced, encrypted; jump back via text links |
| 008 | save-later-tags | Save web articles for later (Mac menu/shortcut, iPhone Shortcut, in-app), mark as read; tags with rename/merge/delete; Library search and tag filter |
| 009 | export-import | JSON/CSV export, merge-by-id import, DB download, reset = new space. The export must also include 004's `duplicate_dismissals`, `items.merged_into`, 007's `highlights`, and 008's `tags`, `item_tags` and saved state (`read_on` NULL) (constitution II) |
| later | book-shelves | User-named shelves for books (the user prefers shelves to tags for books) |
