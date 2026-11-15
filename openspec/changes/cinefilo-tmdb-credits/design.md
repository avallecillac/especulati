## Context

`titles` holds TMDB details filled once (`LinkToTmdb` and `AddTitle` fill only empty fields): `original_title, year, poster_url, genres (JSON text), runtime_min, season_count`. A backfill (`lib/backfill.svelte.ts`) fills imported titles from `needsDetails`. Older app versions refuse unknown `titles` fields, so new synced fields need their own batch tier and a cursor reset (as `watch_order` and `stars` did).

## Decisions

### D1. Fields (titles, synced, fill-only)
- `countries` TEXT: JSON array of ISO 3166-1 alpha-2 codes (`["US","IT"]`). Movie: `production_countries[].iso_3166_1`; series: `origin_country`. Names are shown with `Intl.DisplayNames(['en'], { type: 'region' })`, falling back to the code.
- `directors` TEXT: JSON array of names. Movie: `credits.crew` with `job === 'Director'`, in order, unique, at most 5; series: `created_by[].name`, at most 5.
- `lead_actor`, `lead_actress` TEXT: the first `credits.cast` entry (by `order`) with `gender === 2` / `gender === 1`. Null when none.
- Validation in core: codes match `^[A-Z]{2}$`, at most 20; names 1–200 characters; lists at most 5 directors.
- **"Fetched" marker:** `countries IS NULL` means credits were never fetched. After a fetch, `countries` and `directors` are always written, as `[]` when TMDB has none, so the backfill does not retry them.
- Migration 4 adds the four columns (all nullable) and resets the sync cursor once, like migrations 2 and 3.

### D2. Writes
- `TitleDetails` gains `countries`, `directors`, `leadActor`, `leadActress`; `AddTitle` and `LinkToTmdb` fill them like the other details (only when empty).
- New `FillTmdbCredits { titleId, countries, directors, leadActor, leadActress }`: for a live title that has a `tmdb_id` and `countries IS NULL`; writes only those of the four fields that are empty (`countries`/`directors` always, as arrays). Anything else → no change (`decided([])`), so a racing second fill is harmless.

### D3. Sync tier
`tierOf('titles', fields)` returns `'c'` when any of `countries`, `directors`, `lead_actor`, `lead_actress` is present. If a `titles` op would carry both a tier-`c` field and a tier-`p` field (e.g. `AddTitle` with `watch_order`), core splits it into two changes on the same row in the same decision, one per tier, so a batch never mixes tiers and an old device still gets the base fields. The allow-list validates the new fields (D1 rules); bad values → `ParseError`.

### D4. TMDB client
`tmdbDetails` requests `movie/{id}` or `tv/{id}` with `append_to_response=credits` (same single request) and maps D1. `TmdbDetails` gains the four fields. Fixtures in `catalog/tmdb.test.ts` and `e2e/cinefilo/tmdb.ts` are extended with credits (gender 0/1/2 cases, no director, no actress).

### D5. Backfill
`needsCredits(limit)`: live titles with `tmdb_id` and `countries IS NULL`, newest first. `runBackfill` first does the existing `needsDetails` queue, then this one, with the same pacing, `attempted` set and stop conditions; it sends `FillTmdbCredits`. A failure leaves the title for the next reload or reconnect.

### D6. Display
Title screen, under "Movie · 2024": one muted line, wrapping, separated by " · ": country names, genres (first 3), then on its own line "Directed by A, B" (series: "Created by …") and "With <actor>, <actress>" (whichever exist). Nothing shown for missing parts; nothing at all before the fetch. Tokens only.

### D7. Search
`ListItem` gains `directors`, `leadActor`, `leadActress`, `genres`, `countries` (decoded). The list search (`matchesQuery`) matches when the normalised query is a substring of the title, any director, the actor, the actress, any genre, or any country's English name (or code). The placeholder becomes "Search titles, people, genres". Pending recommendations still match by title only.

## Risks
- **Old phone:** until it updates, it skips tier-`c` batches and shows no new details; everything else syncs.
- **TMDB gender data is incomplete** (gender 0 = unknown): the lead actor/actress may be missing or not the most famous name. Acceptable; shown only when known.

## Implementation notes (reviewed, group 1)
- D3 split is broader than written: any `titles` change mixing a credits field with any other field is split (other fields first, then the credits), in `decide()` and in import, so an old device never loses base fields such as the insert or `tmdb_id`. A credits-only op that arrives before its insert is parked until the insert lands.
- `tierOf` checks `c` before `p`.
- Reconcile carries the four fields from loser to survivor, like the other details.
- The convergence suite draws credits randomness from its own generator, so existing seeded scenarios are unchanged. A shifted stream exposed a pre-existing reconcile ping-pong between an old-version peer and full peers on rows that lag (tier `p`); it is not caused by this change and is tracked separately.
