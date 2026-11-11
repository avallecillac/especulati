## Context

Built on the unreleased `personal-lists` branch (schema v2 not shipped yet). The Together list's fields are shared and LWW per field; the history must converge without coordination between the two phones.

## Decisions

### D1. `watch_order` is a sort key, the number is computed
`titles.watch_order INTEGER NULL` joins the `titles` rebuild in migration 2 (personal-lists has not shipped, so no migration 3). It is a shared field (LWW). The visible number is computed at read time: rank over Together-watched titles ordered by `watch_order` (nulls last), then `watched_on`, `created_at`, `id`. So two titles with the same key (two phones marking different titles watched offline) still get distinct, identical-on-both-devices numbers, and removing a title from Watched renumbers the rest without writes.

### D2. Assigning on Together watched
When `SetStatus` (or `AddTitle`) puts a title into Together `watched` and its `watch_order` is NULL, `decide()` sets `watch_order = max(watch_order over watched titles in the snapshot) + 1` (1 when none). Moving out of Watched clears it to NULL. The snapshot builder supplies the current max. Personal statuses never touch it.

### D3. Sync tier
Any `titles` op that writes `watch_order` is tier `p`, like the personal tables, so a phone on the old version skips it until it updates (its allow-list would otherwise reject the unknown field and the whole batch). Migration 2's cursor reset already re-reads the space on upgrade.

### D4. Import
`cinefilo-titles/v1` entries gain optional `watchOrder` (positive integer; unique within the file; only with `status: "watched"`). `importTitles` adds new titles as today and, for an entry matching an existing title (same derived id or same TMDB id and kind) whose `watch_order` is NULL, sets it. Existing values are never changed. The preview reports `{ new, existing, ordersToSet, invalid }`. One transaction, idempotent.

### D5. Display
- Watched (Together): a small `#N` on each row/tile; a per-device toggle "Newest first / From #1" (`localStorage['cinefilo.watchedOrder']`, frozen, guarded). Newest first = highest number first.
- Reviews first on the title screen: header → Ratings (both verdicts and reviews) → Lists → the rest. Review mark in rows and tiles: a small quote glyph per member who wrote one, `aria-label="Reviewed by <name>"` (or "Reviewed by both").
- Grid: `localStorage['cinefilo.layout']` = `list` | `grid` (frozen, guarded), a two-icon toggle next to the tabs (`aria-label="Layout"`, radios "List" / "Grid"). Three columns of 2:3 tiles at 390 px, poster or generated cover, review mark and `#N` overlaid in a corner, the title as accessible name. Pending recommendations stay as rows above the grid.
- Tokens only; both themes.

### D6. The corrected history file (main session, after implementation)
The keep-import tool's build step emits `watchOrder` for watched entries, in the order of `apps/cinefilo/import.md` (first to latest), shifting everything by one and adding *Triangle of Sadness* (2022) as #1. Lines that expanded into several films (Pirates 1–4, etc.) take consecutive numbers in their part order.

## Risks

- **Titles watched in the app between the first import and this release** have no number and sort after the numbered history, by date; they get numbers only when re-marked. Acceptable; visible and easy to fix later with a "renumber" if needed.

## Implementation notes (reviewed)

- Titles watched with no order sort after the numbered history; "From #1" flips only the numbered part.
- The layout toggle sits in the list header next to Add (the tabs are the bottom bar); the Together Watched list also has a "Newest first / From #1" radiogroup.
- Ratings are two-up at every width so the partner's review shows without scrolling at 390 px.
- Import: a new watched entry without an order is numbered after every order in the file and the list; an order is set on an existing title only when it is Together-watched. The confirm button reads "Set N orders" when only orders change.
- List rows put the verdicts and review mark under the title, so long titles (Willis capitals) wrap by word instead of splitting.
