## Why

Our history lives in two Google Keep lists (about 200 watched, 55 watch-later), copied into `apps/cinefilo/import.md`. They have no dates or scores, mix English, Spanish and German titles, contain typos, notes and several films per line. Typing them in by hand is not an option.

## What Changes

- **Watched date becomes optional.** A title can be watched with no known date (imported history). The title screen shows "Watched · date unknown" with "Add date". Marking watched in the app still defaults to today.
- **Import a titles list** in Settings → Import list: a `cinefilo-titles/v1` JSON file of `{ tmdbId?, kind, title, year?, status }`. The app shows a preview (new, already in the list, invalid), then adds every new title as the current member through `decide()`, in one transaction. Re-importing the same file adds nothing.
- **A local, one-off tool** (`apps/cinefilo/scripts/keep-import/`, never shipped) turns `import.md` into that file:
  1. parse: split lists, strip notes like `(2a vez)`, `**`, `(confort)`, keep hints like a year or `Close - Belgium`, split multi-film lines (`Pirates of the Caribbean 1, 2, 3, 4`, `Pearl (trilogy)`), drop duplicates;
  2. match each title on TMDB (search in Spanish and English, films and series), scoring each candidate;
  3. write `import/review.md` with confident matches collapsed and uncertain ones listed with numbered alternatives;
  4. after decisions are recorded in `import/decisions.json`, write `import/titles.json`.
- All personal files stay in the git-ignored `import/` folder and `apps/cinefilo/import.md`.

Out of scope: scores and reviews (the lists have none), dates, importing into Lector, a generic Keep integration.

## Capabilities

### New Capabilities
- `cinefilo-import`: importing a titles list from a file.

### Modified Capabilities
- `cinefilo-watchlist`: "Mark as watched with a date" — the date becomes optional.

## Impact

`packages/cinefilo-core` (status fields, a new `ImportTitles` validation), `packages/cinefilo-db` (import in one transaction), the worker protocol, Settings and TitleScreen, a new script folder with its own tests, a TMDB key in `.env` (`TMDB_API_KEY`) for the tool only.
