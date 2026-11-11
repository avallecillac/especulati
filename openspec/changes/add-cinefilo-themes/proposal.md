## Why

Cinéfilo ships with a placeholder dark theme. The two of us want it to feel like ours: minimal, abstract, with references only a film person would catch, and no commercial poster art. Two directions were designed and approved on the design canvas ("Cinéfilo look and feel"): **Béton** and **Willis**.

## What Changes

- Two themes replace the placeholder "screening room":
  - **Béton** (light): raw concrete ground, Archivo 800 capitals, IBM Plex Mono labels, one rust accent, square corners and heavy rules, tabs numbered like drawing sheets.
  - **Willis** (dark): near-black, warm tungsten text, Italiana capitals for titles, Libre Caslon Display for reviews and verdicts, Inter for labels, brass accent, an orange dot for "both loved".
- **Appearance** in Settings: Automatic (Béton in light mode, Willis in dark), Béton, or Willis. The choice is per device, never synced, and applied before first paint.
- **Generated covers** by default: an abstract cover derived from each title's id (Béton: ink slabs and a rust bar; Willis: one slit of light). TMDB posters become an option, shown in the theme's treatment (greyscale for Béton, dimmed warm duotone for Willis).
- **Original art** for the welcome screen and the title screen header in each theme (an architectural elevation; a dark room with light through blinds and an orange).
- Fonts are vendored (OFL) and precached, so the look works offline.

Out of scope: per-theme wording changes (labels stay the same in both themes), more than two themes, syncing the appearance choice, the Google Keep import, any Lector change.

## Capabilities

### New Capabilities
- `cinefilo-themes`: the themes, the appearance choice, generated covers and the poster option.

### Modified Capabilities
- None. (`cinefilo-catalog`'s poster requirements still hold; covers are how a title looks when no poster is shown.)

## Impact

- `apps/cinefilo/src/theme/` (new token files, registry, fonts.css, tests), `apps/cinefilo/public/fonts/`, `apps/cinefilo/index.html` (pre-paint script), Settings, List, TitleScreen, Welcome, Poster.
- New dev dependencies only to vendor the font files (Fontsource packages), removed from the runtime bundle.
- New device-local identifiers (frozen, guarded): localStorage `cinefilo.appearance` and `cinefilo.covers`.
