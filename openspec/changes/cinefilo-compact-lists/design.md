## Context

`List.svelte` stacks four full-width rows above the titles (switch, heading + whose line + layout + Add, order radios, verdict chips), all at `--tap: 48px`. `App.svelte` remounts `List` per tab and swaps it for `TitleScreen` on `#/title/<id>`; the list reloads asynchronously, so the browser cannot restore the scroll position and the local `filter` state is lost.

## Decisions

### D1. Header layout (390 px)
```
Watched                      [≡|▦] [+ Add]     row 1, ~40 px
( Together | Ana | Luz )                       row 2, pill switch, 32 px
[⌕ Search titles      ×] [↓|↑] [⚲ Filter]     row 3, 40 px
 Both liked ×                                  only while a filter is on
```
- h1 drops to 1.5 rem. The `whose` line (`data-testid="whose"`) stays in the DOM: visible only for the partner's list ("Luz's list · view only", in `--other-accent`), visually hidden otherwise, so screen readers still hear whose list it is.
- The switch keeps `role="radiogroup" aria-label="List"` and its arrow-key behaviour; it becomes a pill (`--radius-pill`), 32 px high, 0.85 rem labels, one row.
- Layout toggle unchanged in semantics (`radiogroup "Layout"`, radios "List"/"Grid"), 36 px icons. Add is a compact primary button with a plus icon and the text "Add".

### D2. Search
- `<input type="search" aria-label="Search titles" placeholder="Search titles">` with a leading magnifier icon and a themed Clear button (`aria-label="Clear search"`, shown when non-empty; hide the native WebKit cancel button).
- Filtering is in the UI, over the loaded `ListItem[]`, after the watch-order step: match when the normalised query is a substring of the normalised title. Normalise = NFD, strip combining marks (`\p{M}`), lower-case, collapse whitespace, trim. Pure helper `matchesQuery(title, query)` in `apps/cinefilo/src/lib/search.ts` with a unit test.
- While a query is set, pending recommendations are filtered the same way.
- Empty result: "No titles match “<query>”."
- Grid view filters the same way.

### D3. Filter sheet
- One button `aria-label="Filter"` (funnel icon + "Filter" text), `aria-haspopup="dialog"`, `aria-expanded`. When a filter is on it shows the filled (pressed) style via a class (not `aria-pressed`) and a dot.
- The sheet reuses `.backdrop` + `.sheet` (like AddSheet): `role="dialog" aria-modal="true" aria-label="Filter"`, heading "Filter by verdict", a `radiogroup` "Verdict" with "All" + the five `FILTER_LABEL`s. Picking one applies it and closes the sheet; Escape and the backdrop close it; focus returns to the Filter button.
- Below the tools row, an active filter shows as one chip button `aria-label="Remove filter <label>"` with text "<label> ×".

### D4. Watch-order icons
The `radiogroup "Watched order"` stays, with the same radio names "Newest first" and "From #1" as `aria-label`s; each is a 36 px icon (arrow down = newest first, arrow up = from #1), `title` attribute with the same text. Shown only on Together Watched, as today.

### D5. Keeping the place
`listView` (in memory) gains `filter: VerdictFilter | null`, `query: string` and `scroll: Record<string, number>` keyed by `${tab}:${scope}`.
- While `List` is mounted, a passive `scroll` listener stores `window.scrollY` for the current key (rAF-throttled). The listener is removed on unmount, before the next screen renders.
- When `List`'s items load for the first time after mount, it waits for `tick()` and one animation frame, then `window.scrollTo(0, saved)` if a value is saved. Changing the filter, query, scope or layout later does not re-restore.
- `history.scrollRestoration = 'manual'` (set once at start) so the browser does not fight it.
- `TitleScreen` scrolls to the top when it mounts.
- Filter and query survive opening a title and coming back; they reset when the app is reopened (memory only, like the scope). They are shared across tabs.

### D6. Sizes
- `--tap` 48 → 40 px; base button padding 6 px 12 px, font 0.95 rem. Things that already pin sizes keep them: the back control (44 px), the tabbar (56 px), recommendation Accept/Dismiss (≥ 44 px), appearance radios (≥ 44 px), TMDB result Add (≥ 44 px).
- Title screen: `.verdicts-big` becomes a wrapping row; `.verdict` min-height 36 px, padding 4 px 10 px, 0.9 rem. Review textarea `rows="2"`; the character count shows only once a draft exists. Ratings `h2` margins tighten. Lists-block segmented buttons and date-row buttons use 36 px.
- Tokens only, both themes; the theme guard test must stay green.

## Risks
- Restoring before posters load: posters are fixed size (52×72 rows, 2:3 tiles), so the layout height is known before images arrive.
- Smaller targets: everything stays ≥ 32 px, above WCAG 2.5.8 (24 px).

## Implementation notes (reviewed)
- At 390 px the two rating columns are ~150 px wide, so the three verdicts wrap to two rows of 36 px (the stars change replaces them anyway).
- The theme h1 sizes in `type.css` are overridden for the list heading only (1.5 rem), so the layout toggle and Add stay on the heading row.
- The whole header, switch included, sits inside `.list-frame`, so the partner-list frame wraps the switch too.
- `importSeed` moved to `e2e/cinefilo/seed.ts` (shared by `filters.spec.ts` and `compact-lists.spec.ts`).
