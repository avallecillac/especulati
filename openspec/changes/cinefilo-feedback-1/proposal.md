## Why

First feedback from using Cinéfilo together, to land before personal lists ships:
1. Each other's reviews are easy to miss: they sit below the new Lists block on the title screen, and the lists give no hint that a review exists.
2. Our Keep note was numbered in the order we watched things (first to latest). The numbers were dropped before the import, and *Triangle of Sadness*, the first film we watched together, was missing from it.
3. A poster-only grid makes the lists easier to browse.

## What Changes

- **Reviews first:** the title screen shows both members' verdicts and reviews right under the title header, before the Lists block. List rows and grid tiles get a small mark when either member has written a review.
- **Watch history order:** Together-watched titles get a shared sort key `watch_order`. The Watched list shows each title's number (#1 = first watched together), newest first by default, with a per-device toggle to start from #1. Marking a title watched on Together gives it the next number.
- **Import with order:** `cinefilo-titles/v1` entries may carry `watchOrder`. Importing sets it on titles that don't have one yet (never overwriting), so re-importing the corrected Keep list numbers the existing history. The corrected file adds *Triangle of Sadness* as #1.
- **Grid view:** a list/grid toggle next to the tabs, remembered per device. Grid shows posters only (generated cover when there is none), three per row, each opening the title.

Out of scope: editing numbers by hand (drag to reorder), numbering personal lists, statistics.

## Capabilities

### New Capabilities
- `cinefilo-history`: the shared watch order and its display.
- `cinefilo-list-layout`: the list/grid choice.

### Modified Capabilities
- `cinefilo-ratings`: "Both members' ratings visible" (placement and list hint).
- `cinefilo-import`: titles files may carry a watch order.

## Impact

`cinefilo-core` (field, decide, allow-list, tier, titles file parser), `cinefilo-db` (column in schema v2 — personal-lists has not shipped, so it joins migration 2), read models, TitleScreen, List, Settings import, the keep-import tool. Builds on the `personal-lists` branch and ships with it, preview first.
