## Context

`apps/cinefilo/import.md` (git-ignored): line 1 `watched`, a blank-free list, then a `watch_later` line and the second list. No dates or scores. Observed patterns: mixed languages, typos, inline notes (`(2a vez)`, `(II)`, `**`, `(confort)`, `(20.03.2025)`), hints (`Fracture (2007)`, `Close - Belgium`), multi-film lines (`1, 2, 3, 4`, `1 y 2`, `1,2 y 3`, `A/B`, `(trilogy)`), duplicates, a few series, many one-word titles.

## Decisions

### D1. Watched date optional
`statusFields` accepts `watched` with no `watchedOn` (field written as `null`); `dropped` still requires a date. The app's own "Mark watched" keeps defaulting to today. TitleScreen shows "Watched · date unknown" plus "Add date". Lists sort undated watched titles after dated ones, by `created_at`.

### D2. File format `cinefilo-titles/v1`
```json
{ "format": "cinefilo-titles/v1",
  "titles": [ { "kind": "movie", "title": "Inception", "year": 2010, "tmdbId": 27205, "status": "watched" } ] }
```
Parsed strictly in `cinefilo-core` (`parseTitlesFile`), all-or-nothing like the `cinefilo/v1` export. `status` ∈ later | watching | watched; `watching` only for series.

### D3. Import in the worker
`importTitles(file, env)` builds one `AddTitle` per entry (TMDB-derived id when `tmdbId` is set, manual label otherwise — the existing derived-id rules), skips `AlreadyExists`, and applies all changes in one `applyChanges` transaction. The preview is the same pass without writing. Reconcile runs once afterwards. Details and posters for imported TMDB titles are filled lazily by the existing `LinkToTmdb`/poster paths when a key is set (a background queue, a few per minute, never blocking).

### D4. The local tool
`apps/cinefilo/scripts/keep-import/` (Node 22, run with `pnpm --filter cinefilo keep-import <step>`), excluded from the app bundle and from depcruise app rules; it may import `cinefilo-core` for `titleKey`.
- `parse` → `import/parsed.json`: entries `{ line, list, title, year?, hint?, kind? }`. Multi-film lines expand to numbered parts (`Pirates of the Caribbean 1` … `4`); `(trilogy)` and `A/B` expand by TMDB collection/the two names; `(2a vez)` drops the duplicate; notes are stripped but kept in `note`.
- `match` → `import/matches.json` + `import/review.md`: TMDB `search/multi` with `language=es-ES` then `en-US`; candidates scored by normalized-title similarity (Spanish or original or English title), year hint, kind hint, popularity; **confident** = top score ≥ 0.9 and a clear lead over the next. Collections are resolved via `search/collection` for multi-film lines. Requests are throttled (≤ 4/s) and cached in `import/cache/`.
- `review.md` lists uncertain lines as `### 12. Nine` with numbered candidates (`1) Nine (2009) movie · Rob Marshall`) plus `0) skip`, `m) manual`. Decisions go into `import/decisions.json` (`{ "12": 1 }`), filled by the main session from the user's answers.
- `build` → `import/titles.json` (`cinefilo-titles/v1`), with a summary (counts per list, skipped, manual).

### D5. Privacy
Everything personal stays in git-ignored paths. The tool reads `TMDB_API_KEY` from `.env` and never writes it to output. Nothing is uploaded except TMDB search queries.

## Risks

- **Wrong match on a one-word title** → review list, never auto-accept below the threshold.
- **Collections mis-split** (`Juegos del hambre 1,2 y 3` = three films, not four) → expand from the collection's parts ordered by release, limited to the numbers on the line.
- **Large single transaction (~260 titles)** → well within SQLite limits; measured in a test.
