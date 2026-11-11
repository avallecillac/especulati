## Why

After the themes shipped, titles showed generated covers instead of the TMDB posters the first version showed. That was too broad a reading of "no commercial art": the two of us want to recognise films by their posters, as before.

## What Changes

- TMDB posters are the default again; generated covers remain the fallback for titles without a cached poster, and an opt-in choice in Settings → Covers.
- Posters show in their original colours in both themes (no greyscale or sepia treatment). The `--poster-filter` token stays in the contract, set to `none`.
- Settings lists "TMDB posters" first.
- The stored value flips: the key `cinefilo.covers` is absent for posters and holds `generated` when a member chose generated covers. Devices that never chose get posters.

Out of scope: any change to the generated cover art, poster caching or TMDB.

## Capabilities

### Modified Capabilities
- `cinefilo-themes`: the "Posters are optional" requirement.

## Impact

`apps/cinefilo/src/lib/covers.svelte.ts`, `theme/beton.css`, `theme/willis.css`, `screens/Settings.svelte`, `theme/frozen.ts` (comment only), e2e `themes.spec.ts` and `appearance.spec.ts`.
