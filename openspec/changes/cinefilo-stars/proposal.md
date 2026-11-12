## Why

Like / Meh / Didn't like is too coarse. The members want to rate each title from 0.5 to 5 stars, in half stars. They chose to start fresh rather than convert the old verdicts, and to drop the verdict-based list filters.

## What Changes

- **Stars:** each member rates a title 0.5–5 stars in half steps, on the title screen, with one tap or drag on a row of five stars. Their own rating can be cleared.
- **Fresh start:** stars are a new field. Old verdicts are no longer shown or written anywhere in the UI, so every title starts as not rated. Reviews stay. The old verdict values stay untouched in the database and in backups (dormant, reversible), and are never deleted.
- **Lists:** rows show each member's stars compactly (initial, a star, the number, e.g. `A ★ 4.5   L ★ 3`). The "both loved" mark goes.
- **No score filters:** the five verdict filters, the Filter button, its sheet and the active-filter chip are removed. The tools row keeps search and the watch-order icons.
- **Sync rollout:** ops that write `stars` travel in their own batch tier (`r`), so a phone still on the old version skips them rather than rejecting a whole batch; migration 3 resets the sync cursor once so it catches up after updating.

Out of scope: converting or showing old verdicts, averages or statistics, sorting by stars, star filters. No Lector code or identifier is touched. No frozen Cinéfilo identifier changes; the `cinefilo/v1` export format gains an optional `stars` key on rating rows.

## Capabilities

### Modified Capabilities
- `cinefilo-ratings`: stars replace verdicts; the verdict filters are removed.
- `cinefilo-list-layout`: the compact header loses the Filter button.

## Impact

`cinefilo-core` (types, `SetStars` replaces `SetVerdict`, allow-list, `tierOf`, export, reconcile; `filters.ts` removed), `cinefilo-db` (migration 3, read models, `list()` loses its filter argument, io), the worker protocol, `List.svelte`, `TitleScreen.svelte`, a new `Stars.svelte`, `FilterSheet.svelte` and `Verdict.svelte` removed, CSS, and the Cinéfilo e2e specs that rate or filter.
