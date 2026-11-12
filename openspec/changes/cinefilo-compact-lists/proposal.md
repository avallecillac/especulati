## Why

Feedback from daily use of Cinéfilo on a phone:
1. There is no way to find a title in a long list (Watched has the whole shared history).
2. The list header is cluttered and takes almost half the screen at 390×844: the list switch, a two-line heading, the layout toggle and Add, the "Newest first / From #1" radios, and five verdict chips each sit on their own full-size row.
3. Buttons are too big everywhere; on the title screen the verdicts and reviews take most of the first screen.
4. Opening a title from halfway down a list and going back lands at the top, so you lose your place.

## What Changes

- **Search:** a search field in every list header filters the list on screen by title as you type (case- and accent-insensitive), with a Clear button. It works offline (the list is local).
- **Compact header:** one heading row (title, layout toggle, Add), a slim pill switch for Together / me / partner, and one tools row: search, the watch-order icons (Together Watched only) and a single **Filter** button. The five verdict chips move into a Filter sheet; the active filter shows as one removable chip.
- **Order icons:** "Newest first" and "From #1" become two small arrow icons (down, up) with those names as their accessible labels.
- **Smaller controls:** the shared control height drops from 48 to 40 px (no control under 32 px, WCAG 2.5.8 is 24 px). On the title screen the three verdicts sit in one row and the review box starts at two lines.
- **Place kept:** going back from a title returns the list to where it was scrolled, with its filter and search still applied. A title always opens at its top.

Out of scope: searching TMDB from the list (Add already does that), filters other than the existing verdict filters, sorting other than the existing watch order, any change to storage, sync or the read models. No Lector code or identifier is touched; no new storage key (search, filter and scroll live in memory only).

## Capabilities

### Modified Capabilities
- `cinefilo-list-layout`: search, the compact header, and the kept scroll position.

## Impact

`apps/cinefilo` only: `screens/List.svelte`, a new `screens/FilterSheet.svelte`, `lib/listView.svelte.ts`, `screens/TitleScreen.svelte`, `app.css`, `theme/details.css`. E2E specs that drive the old chips and order radios (`filters.spec.ts`, `feedback.spec.ts`) are updated.
