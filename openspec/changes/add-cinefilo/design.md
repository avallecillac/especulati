# Design

## Context

- Lector already has a local-first stack:
  - SQLite-WASM on OPFS, in a DB worker;
  - every write through a pure `decide()`;
  - per-field last-writer-wins (LWW) on hybrid logical clocks (HLCs), with `field_clock` and `change_log`;
  - an inbox for ops that arrive before their row;
  - AES-GCM envelopes over an HKDF-derived space;
  - a zero-knowledge relay on Cloudflare Pages Functions + D1.
- `extract-shared-sync` turns the non-domain parts into shared packages. They are parameterized per app: the salt, AAD prefix, QR prefix, the remote-op allow-list, and a store interface the engine syncs over.
- Cinefilo is the second consumer of those packages. It brings its own domain and its own deployment.
- Motivation and scope are in `proposal.md`; the behaviour required is in `specs/cinefilo-*/spec.md`.

## Goals / Non-Goals

**Goals:**
- Two people can edit one catalog offline on any device, and every device converges with no merge prompts.
- Each member's ratings are single-writer, so verdicts never conflict.
- Concurrent additions of the same title collapse into one row without coordination.
- Reuse the shared sync packages unchanged. Cinefilo only supplies its schema, its allow-list and its identifiers.

**Non-Goals:**
- A CRDT library, or text merging inside reviews. A review has a single writer, so LWW is exact.
- Authenticating one member against the other.
- Lector compatibility. The two apps never share a database, a space or a device identity.

## Decisions

### D1. Packages and boundaries

```
packages/cinefilo-core   pure: branded types, commands, decide(), title-key normalization, filters, export DTO
packages/cinefilo-db     schema v1 + migrations, applyChanges via shared plumbing, read models (lists, filters)
apps/cinefilo            Svelte 5 PWA, DB worker, TMDB client, poster cache, sync wiring, theme
functions/ (cinefilo)    Pages Functions adapter mounting the shared relay handler on D1 binding CINEFILO_RELAY_DB
```

- `cinefilo-core` follows lector's core purity rules: no DOM, SQLite, `fetch`, clock or randomness. Ids and `now` come in inside the command.
- dependency-cruiser enforces that there are no imports between `cinefilo-*` and lector packages. The shared packages import neither.
- *Alternative rejected:* putting cinefilo tables inside lector's packages. That would couple the two release cycles, and it breaks the reason for separate spaces.

### D2. Schema v1 (synced tables)

```sql
CREATE TABLE titles (
  id             TEXT PRIMARY KEY,            -- derived, see D3
  kind           TEXT NOT NULL CHECK (kind IN ('movie','series')),
  title          TEXT NOT NULL,
  original_title TEXT,
  year           INTEGER,
  tmdb_id        INTEGER,
  poster_url     TEXT,                        -- TMDB path; image bytes are local-only (D8)
  genres         TEXT,                        -- JSON array of strings
  runtime_min    INTEGER,                     -- movies
  season_count   INTEGER,                     -- series
  status         TEXT NOT NULL CHECK (status IN ('later','watching','watched','dropped')),
  watched_on     TEXT,                        -- local YYYY-MM-DD; set with watched/dropped, NULL otherwise (D5)
  current_season INTEGER,                     -- series only
  merged_into    TEXT,                        -- set on a row merged away (D4)
  added_by       TEXT NOT NULL,               -- member id
  created_at     TEXT NOT NULL,               -- UTC ISO-8601
  deleted_at     TEXT                         -- tombstone
);
CREATE TABLE members (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE ratings (
  id         TEXT PRIMARY KEY,                -- derived, see D3
  title_id   TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  verdict    TEXT CHECK (verdict IN ('like','meh','dislike')),   -- NULL = cleared
  review     TEXT CHECK (review IS NULL OR length(review) <= 1000),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
-- shared plumbing: field_clock, change_log, meta, sync_inbox (from extract-shared-sync)
-- local-only: posters(title_id PK, mime, bytes, fetched_at)
```

- **Local-only `meta` keys:**
  - `member_id`, the device's identity (D6);
  - `tmdb_key`;
  - the sync keys and cursors.

  None of them are in `change_log`.
- **Indexes:** partial indexes with `WHERE deleted_at IS NULL AND merged_into IS NULL` on:
  - `titles(status, watched_on)`;
  - `titles(tmdb_id, kind)`;
  - `ratings(title_id)`.

### D3. Derived ids: concurrent inserts converge

All ids for catalog rows are computed in the shell, as `uuidFromHash(label)`, and passed into the command:

| Row | Label |
|---|---|
| title from TMDB | `cinefilo-title-v1\|tmdb\|<kind>\|<tmdb_id>` |
| manual title | `cinefilo-title-v1\|manual\|<kind>\|<titleKey(title)>\|<year or "">` |
| rating | `cinefilo-rating-v1\|<title_id>\|<member_id>` |
| member | random UUID, created once per person |

- `titleKey` is a pure function in core: NFKD, strip combining marks, lowercase, collapse whitespace and punctuation, trim. Core owns the normalization; the shell owns the hashing.
- When two devices add the same title, they produce the same primary key. The inserts become the same row, and each field merges by LWW.
- Rating ids are a function of `(title, member)`. Only that member's devices ever write the row, so the only possible "conflict" is between one member's own devices, and LWW is the right answer there.
- Members use random ids on purpose. Two different people who both type "Ana" must stay two people. If one person creates a duplicate member, they fix it by picking the original under "who am I"; the stray member is tombstoned.

### D4. Linking a manual title to TMDB

There are two options:

- **(a)** Keep the manual row's id and fill `tmdb_id` and the other details.
- **(b)** Re-key the title to the TMDB-derived id.

**Choice: (a).** A plain field update keeps every rating id valid, since those ids hash the title id, and it needs no copy. Option (b) would have to copy every rating to new ids.

The residual case is a duplicate: a TMDB-derived row with the same `(tmdb_id, kind)` already exists, or appears later through sync because the partner added the film from TMDB. A pure, deterministic **reconcile** pass, the same pattern as lector's 008 reconcile, merges such pairs:

- **Survivor:** the row whose id equals the TMDB-derived id, else the smaller id.
- **Shared fields** (`status`, `watched_on`, `current_season`, details): each field takes whichever row's value has the greater field HLC. They are copied onto the survivor only when the loser's is newer.
- **Ratings:** for each member, the loser's rating is copied onto `rating(survivor, member)` only when its `verdict`/`review` HLC is newer than the survivor's.
- **The loser** gets `merged_into = survivor` and is excluded from every read model. It is not tombstoned, so a stray late edit to it is still caught by the next reconcile.
- **When it runs:** after each sync, and after any local `AddTitle` or `LinkToTmdb`. Each device may run it, and because the inputs converge, the output ops converge too.

### D5. Merge rule per field

| Table.field | Rule | Notes |
|---|---|---|
| titles.* (all mutable fields) | LWW per field on HLC | Both change status at once: the later HLC wins on every device. This is rare and acceptable, because both see the result and can change it |
| titles.status + watched_on | Separate fields, both LWW | `SetStatus` writes both fields in one change with the same HLC. A concurrent `SetStatus` from the partner wins or loses on both fields together, since it also writes both with one HLC |
| titles.current_season | LWW | Independent of status, so "season 2" plus "watching" from two devices both survive |
| titles.deleted_at | LWW (tombstone is a field) | Removal and restore are ordinary field writes |
| titles.merged_into | LWW, written only by reconcile | Deterministic survivor, so every writer writes the same value |
| members.name | LWW | Renames from either device |
| ratings.verdict, review | LWW, single member writes | A rating stored on a removed title survives the removal and comes back with a restore |

- No table has events, so there is no union merge. A rewatch history would be a future `watch_events` table.
- `watched_on` is cleared when the status goes back to `later` or `watching`.

### D6. Member identity and ownership

- `meta.member_id` is device-local. "Who am I" sets it, and it is never synced.
- **Every rating command** carries `memberId`, which is filled from meta. `decide()`:
  - rejects the command when `memberId` is not the device's member (`NotYourRating`);
  - rejects it when the member is unknown or tombstoned.
- `added_by` on titles is informational only.
- **Remote ops** bypass `decide()`, under lector's constitution exception, which cinefilo adopts. The allow-list checks the table, the writable fields and well-formed ids. It cannot check which member wrote a remote rating.
- **Security note:** the app is trust-based. Anyone holding the space code can read everything and write as either member: a modified client can forge the other member's rating. This is accepted for a two-person shared list. The only revocation is starting a new space (`cinefilo-sharing` spec), which creates a new secret and leaves out the old one.

### D7. Commands (pure `decide()`)

| Area | Commands |
|---|---|
| Catalog | `AddTitle` (manual or TMDB payload, id precomputed), `EditTitleDetails`, `LinkToTmdb`, `RemoveTitle`, `RestoreTitle` |
| Watchlist | `SetStatus` (+ `watchedOn` for watched or dropped; it rejects watching or dropped for a movie), `SetCurrentSeason` (≥ 1, ≤ `season_count` when known; series only) |
| Ratings | `SetVerdict` (like, meh, dislike, or null), `SetReview` (trimmed, ≤ 1000; empty → null) |
| Members | `CreateMember`, `RenameMember`, `RemoveMember` (tombstone, used for duplicates) |
| Maintenance | `ReconcileTitles` (D4) |

- Each command returns a `Change[]`, or a `Rejection`.
- `AddTitle` on an id that already exists, and isn't deleted, returns `AlreadyExists`, with the id the UI uses to open the existing entry.

### D8. TMDB client and posters

- **Where it runs:** the shell (`apps/cinefilo/src/catalog/tmdb.ts`), using `fetch`, with an 8 s deadline per lookup.
- **Endpoints:** `search/multi` (movie and tv results), `movie/{id}` and `tv/{id}`.
- **The key:** the user's own v3 API key or v4 read token, from `meta.tmdb_key`, sent only to `api.themoviedb.org`. It is never logged and never included in thrown errors.
- **Posters:** the DB worker fetches `image.tmdb.org/t/p/w342<poster_path>`, downscales the image to at most 480 px tall, and stores it in the local `posters` table, the same approach as lector's covers. That table is not in `change_log`.
- **Attribution:** the TMDB notice and logo appear in Settings → About.

### D9. Sync wiring

- Cinefilo instantiates the shared engine with:
  - `salt = 'cinefilo-sync-v1'`;
  - AAD prefix `cinefilo/v1/`;
  - QR prefix `cinefilo:sync:1:`;
  - its allow-list (`titles`, `members`, `ratings`, with their writable fields);
  - the relay base `/api/v1` on its own origin.
- **Batch tiers:** schema v1 has one tier for every table. The `tierOf` hook is kept, so a future table (for example `watch_events`) gets its own tier, and older devices skip only that tier.
- **Deployment:** a new Pages project with D1 binding `CINEFILO_RELAY_DB`, and the shared `schema.sql` applied to the new database.

### D10. Export

- The format is `cinefilo/v1` JSON. It includes titles (with `merged_into` and `deleted_at`), members and ratings.
- It never includes `meta`, posters or the TMDB key.
- Import merges by id through the same write path as remote ops, in one transaction.

### D11. UI (design level)

- **Tabs:** Watch later, Watching, Watched, plus Settings.
- **Lists:** poster rows, each showing both members' verdict glyphs. A filter chip row offers the verdict filters.
- **Add sheet:**
  - a search field (TMDB) with a Movie/Series toggle;
  - results with an **Add** button;
  - "Add by hand" as a fallback.

  Adding a result takes 1 tap, plus an optional status choice: at most 2 taps.
- **Title screen:**
  - poster and details;
  - a status control;
  - a watched-date picker with Today and Yesterday;
  - a season stepper for series;
  - two rating columns, me and the partner, each with three large buttons and a review field. The partner's column is read-only. Rating takes 1 tap.
- **Theme:** its own token file, using the same token contract approach as lector's 006, but not lector's palettes.

### Constitution check (adopted for cinefilo)

Lector's constitution governs lector. Cinefilo adopts the following principles from it:

| Principle | Status |
|---|---|
| I. Local-first | PASS: every write is local, and TMDB and sync are optional |
| II. User owns data | PASS: E2E encryption, the `cinefilo/v1` export and import, no analytics. The one third-party call is TMDB, with the user's own key, and it sends only the query text |
| III. Events over state | N/A: there is no progress log in v1 |
| IV. Functional core | PASS: a pure `decide()`, one transaction per decision, and the remote-op exception with an allow-list |
| V. Low friction | PASS: adding takes at most 2 taps after search, rating takes 1 tap |
| VI. Simplicity | PASS: LWW + HLC, no CRDT library, and it reuses the shared packages |
| VII. Verified | PASS: core tests, db tests, a convergence test with 2 members and 3 devices, Playwright flows |

Lector is not touched, so its own check has nothing to evaluate.

## Risks / Trade-offs

- **[Risk] Forged ratings by a modified client.** → Accepted (D6): this is trust-based by design, the disclosure is shown in Settings, and the fix is a new space.
- **[Risk] Manual-title normalization merges two genuinely different titles**, ones with the same name, kind and year. → This is unlikely. To undo it, the user edits the year, or adds one copy from TMDB.
- **[Risk] Concurrent status edits:** one member's change silently loses. → It's visible right away in the list. The two people talk to each other, and that is acceptable for this domain.
- **[Risk] A device keeps editing a row that reconcile merged away.** → `merged_into` rows stay in reconcile's input, so the late edit is carried over on the next pass when it is newer.
- **[Risk] The TMDB key could leak through errors or exports.** → It is kept in device-local `meta` only, excluded from export, and the redaction is checked by a test.
- **[Risk] Free tier:** the relay serves two people now. → The data is small (hundreds of rows). The relay's rate limits are already per space.
- **[Trade-off] A single `watched_on`** means a rewatch overwrites the date. This is deferred to a `watch_events` table.

## Migration Plan

This is a new app with no data migration. The steps to deploy:
1. The user creates the Pages project and the D1 database, and applies the relay schema.
2. Deploy from CI.
3. Open the app on the first device, start a shared list, and pair the other devices.

To roll back, delete the Pages project. Lector is unaffected throughout.

## Open Questions

- **Per-season ratings for series.** Out of scope for v1. They would be a new `season_ratings` table in its own tier, with no change to v1 rows.
- **Rewatches.** A single `watched_on` in v1. A `watch_events` table later would keep v1's field as "last watched".
- **Hiding the partner's verdict until you rate.** The default is visible. This could become a device-local display preference, with no data model impact.
- **TMDB terms.** Attribution is required, and it is covered by the `cinefilo-catalog` spec. Confirm that non-commercial personal use with a personal key fits TMDB's current terms before deploying.
