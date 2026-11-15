## Why

We want more from TMDB about each title (country, genre, director, lead actor, lead actress), so we can search by them now and build wrap-ups on them later ("our most-watched director", "films by country"). Genres are already stored; the rest is not.

## What Changes

- **New title details:** countries, directors (for a series: its creators), the top-billed actor and the top-billed actress. They are fetched from TMDB with the existing details call (plus credits) when a title is added or linked, and synced to both phones like the other details.
- **Backfill:** titles already linked to TMDB get the new details in the background, using the existing paced backfill (one request every 2 s; only with a key and a connection).
- **Title screen:** a compact details line under the year: countries, genres, "Directed by …" (or "Created by …"), "With <actor>, <actress>".
- **Search:** the list search also matches directors, the lead actor and actress, genres and country names, not just the title.

Out of scope: the wrap-ups themselves (a later change, built on this data), more than one actor and one actress, editing these details by hand, person pages. No Lector code or identifier is touched; no frozen Cinéfilo identifier changes. The `cinefilo/v1` export gains optional keys on title rows.

## Capabilities

### Modified Capabilities
- `cinefilo-catalog`: richer TMDB details and the backfill.
- `cinefilo-list-layout`: search also matches people, genres and countries.

## Impact

`cinefilo-core` (title fields, `FillTmdbCredits`, allow-list, `tierOf`, export), `cinefilo-db` (migration 4, read models, `needsCredits`), the TMDB client (`append_to_response=credits`), backfill, `AddSheet`/link, `TitleScreen`, `List` search, e2e and TMDB fixtures.
