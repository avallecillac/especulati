# Readerlog — Architecture Spec

## 1. Product summary

Readerlog is a **personal, single-user mobile app** for logging books and web articles and viewing reading stats.

- **Not a reader.** No in-app reading, no stored article text.
- **Books:** logged with progress updates. These drive the headline stat, *reading days per year*.
- **Articles:** logged once, when read. They feed counts and stats only and **never** count toward reading days.
- **Audience:** one user (the owner). No auth, no multi-tenancy, no social features.

## 2. Guiding principles

1. **Local-first.** The on-device SQLite database is the source of truth. Every read and write is local and works offline.
2. **Minimal backend.** Add a server only for things the phone can't do well (article metadata extraction). No always-on infrastructure.
3. **Events over state for books.** Record book progress as an append-only event log, not by overwriting status fields, so historical stats stay computable.
4. **Near-zero logging friction.** Data completeness depends on how easy logging is, so every capture flow should take 1–2 taps.

## 3. System overview

```
┌──────────────────────── Mobile app ────────────────────────┐
│  UI (log, library, stats)   Widgets   Share extension      │
│              │                  │            │             │
│              └──────── SQLite (source of truth) ───────────┤
│                              │                             │
│                        iCloud backup                       │
└──────────────┬──────────────────────────────┬──────────────┘
               │                              │
     Book metadata APIs              Article metadata function
  (Open Library / Google Books)     (serverless, stateless, optional)
```

| Component | Responsibility |
|---|---|
| Mobile app | All UI, storage, stats computation, charts |
| SQLite | The only persistent store |
| Share extension | Captures article URLs from Safari/other apps |
| Barcode scanner | Captures book ISBNs |
| Book metadata API | ISBN → title, authors, page count, subjects/genre, cover |
| Article metadata function | URL → title, author, domain, word count (text discarded) |
| Backup | Periodic export of the DB to iCloud; no multi-device sync |

## 4. Data model

```sql
CREATE TABLE items (
  id            TEXT PRIMARY KEY,          -- UUID
  type          TEXT NOT NULL CHECK (type IN ('book', 'article')),
  title         TEXT NOT NULL,
  author        TEXT,
  -- books
  isbn          TEXT,
  total_pages   INTEGER,
  genre         TEXT,
  cover_url     TEXT,
  -- articles
  url           TEXT,
  domain        TEXT,
  word_count    INTEGER,
  read_on       TEXT,                      -- local date YYYY-MM-DD; set on capture
  -- common
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  created_at    TEXT NOT NULL              -- UTC ISO-8601
);

-- Books only. Append-only.
CREATE TABLE reading_events (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES items(id),
  event_type    TEXT NOT NULL CHECK (event_type IN ('started', 'progress', 'finished', 'abandoned')),
  page          INTEGER,                   -- optional; NULL = "read today" without a page
  occurred_at   TEXT NOT NULL,             -- UTC ISO-8601
  local_date    TEXT NOT NULL              -- YYYY-MM-DD in the user's local timezone at time of reading
);

CREATE TABLE tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id),
  tag_id  TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX idx_events_item_date ON reading_events(item_id, local_date);
CREATE INDEX idx_events_date      ON reading_events(local_date);
CREATE INDEX idx_items_type_read  ON items(type, read_on);
```

### Rules

- `reading_events` is used **only for books**. Articles have no events. Their `read_on` date is the whole log.
- **Book status is derived**, never stored. It comes from the latest event: none means queued, `started`/`progress` means reading, `finished` means done, `abandoned` means abandoned.
- **`local_date` is required and explicit.** It is the calendar date the user experienced, taken from the device's timezone when the event happened, or set manually when backdating. Never derive it from UTC at query time.
- `page` is optional on `progress` events. A page-less event still counts as a reading day but is ignored by pace calculations.
- Multiple events per book per day are allowed.

## 5. Capture flows

### Add a book
1. Scan the ISBN barcode (or search by title as a fallback).
2. Look up metadata: Open Library first, Google Books as the fallback.
3. Show a pre-filled confirmation screen and save the `items` row.
4. Offer "Start reading now", which inserts a `started` event.

### Log book progress (the most frequent action; optimize hardest)
- Entry points: a home-screen/lock-screen widget for the current book, and the book detail screen.
- Pre-fill the last logged page, so the user adjusts a number rather than typing one.
- A secondary action, **"Read today"**, logs a `progress` event with `page = NULL`.
- A date selector defaults to today, with a one-tap **"Yesterday"** for backdating. Backdated events set `local_date` accordingly.
- Reaching `total_pages` prompts "Mark as finished?", which inserts a `finished` event.

### Log an article
1. Tap Share → Readerlog in any app.
2. The share extension saves the item immediately with `url`, `domain`, and `read_on = today (local)`. **Sharing = read.** There is no queue state.
3. In the background (or on the next app open), call the article metadata function to fill in `title`, `author`, and `word_count`. Failure is non-fatal, so keep the URL and domain.

### Optional reminder
- An evening local notification, sent **only if** a book is in progress and nothing was logged today. It is configurable and off by default.

## 6. Article metadata function

A stateless serverless function (e.g. Cloudflare Worker, Vercel, or AWS Lambda).

- **Input:** `{ "url": "https://..." }`
- **Process:** fetch the page, parse Open Graph/meta tags, run Readability to extract the body, count the words, then **discard the text**.
- **Output:** `{ "title", "author", "domain", "word_count" }`
- **No storage, no auth beyond a static API key** baked into the app (single user).
- Timeout of about 10 s. The app treats any failure as "metadata unavailable".
- MVP fallback: skip the function and parse Open Graph tags on-device (no word count).

## 7. Stats

All stats are computed on-device with SQL over the local DB.

### Reading days per year (headline stat, books only)
```sql
SELECT strftime('%Y', e.local_date) AS year,
       COUNT(DISTINCT e.local_date) AS reading_days
FROM reading_events e
JOIN items i ON i.id = e.item_id
WHERE i.type = 'book'
GROUP BY year;
```

### Other stats to implement
| Stat | Source |
|---|---|
| Reading-day calendar heatmap | distinct `local_date` from book events |
| Current and longest streak | consecutive distinct `local_date`s |
| Books finished per month/year | `finished` events |
| Pages read per period | positive deltas between consecutive non-null `page` values per book |
| Pages per reading day | pages read ÷ reading days |
| Average days to finish a book | first `started` → `finished` per book |
| Abandon rate (overall, by genre) | `abandoned` vs `finished` |
| Articles read per week/month | `items.read_on` where `type = 'article'` |
| Estimated article reading time | `SUM(word_count) / 238` wpm |
| Top authors, genres, article domains | grouped counts over `items` |

Streaks and reading days are **books only**. Article stats are shown in a separate section.

## 8. Backup

- Export the SQLite DB to iCloud periodically (e.g. daily when the app is backgrounded) and on demand.
- Provide restore-from-backup and a plain JSON/CSV export (for data portability).
- No multi-device sync in scope.

## 9. Out of scope

In-app reading or article text storage · accounts/auth · multi-user or social features · web client · real-time sync · AI features (may come later; the article function is the natural hook).

## 10. Open decisions (confirm with the owner before building)

1. **Client stack:** Expo/React Native + `expo-sqlite`, or native Swift + SQLite/GRDB. This affects widget and share-extension ergonomics (native is simpler for both on iOS).
2. **Platform:** the iCloud backup assumes iOS. Confirm the target platform(s).
3. **Article metadata:** ship the serverless function in v1, or start with on-device Open Graph parsing only.
4. **Charts library:** Swift Charts (native) or Victory Native / similar (Expo).

## 11. Suggested build order

1. SQLite schema and data layer, with book add (manual entry) and progress logging
2. ISBN scan with metadata lookup
3. Stats screen: reading days per year, heatmap, streaks
4. Article share extension (Open Graph only)
5. Progress widget
6. Article metadata function and word-count stats
7. iCloud backup/export and the optional reminder
