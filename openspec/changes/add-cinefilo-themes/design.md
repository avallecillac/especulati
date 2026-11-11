## Context

Approved on the design canvas "Cinéfilo look and feel" (Béton and Willis rows, including each token sheet). Cinéfilo already keeps every colour in one theme file (`apps/cinefilo/src/theme/screening-room.css`), guarded by `theme-guard.test.ts`. Lector solved the same problem in feature 006 (`apps/lector/src/theme/`: per-theme CSS, `themes.ts` registry, pre-paint script, contrast and token tests, vendored fonts in `public/fonts`). Cinéfilo copies that pattern; it must not import Lector.

## Goals / Non-Goals

**Goals:** two themes plus Automatic, applied before first paint; offline fonts; deterministic generated covers; optional posters in the theme's treatment; original art; AA contrast.

**Non-Goals:** per-theme copy, user-made themes, syncing appearance, animations beyond what exists.

## Decisions

### D1. Token contract
One file per theme, `apps/cinefilo/src/theme/<id>.css`, holding exactly one `:root[data-theme='<id>']` rule that sets every contract token. The current token names stay (screens already use them), plus new ones:

| Token | Béton | Willis |
|---|---|---|
| `--bg` | `#D5D1C8` | `#0D0B09` |
| `--surface` | `#BDB8AE` | `#17130F` |
| `--surface-2` | `#C9C5BC` | `#211B16` |
| `--ink` | `#161615` | `#EADFC8` |
| `--ink-soft` | `#5E5B55` | `#A39478` |
| `--rule` | `#161615` | `#3A3127` |
| `--hairline` | `#A8A399` | `#2A231C` |
| `--accent` | `#9C3D24` | `#D4A253` |
| `--on-accent` | `#F2EFE8` | `#0D0B09` |
| `--both-loved` | `#9C3D24` | `#D9762B` |
| `--danger`, `--like`, `--meh`, `--dislike` | chosen per theme to pass contrast | idem |
| `--font-title` | Archivo 800, caps | Italiana 400, caps, +1.5px |
| `--font-text` | Archivo 500 | Libre Caslon Display |
| `--font-label` | IBM Plex Mono 400–500 | Inter 400–500 |
| `--radius`, `--radius-sheet`, `--radius-pill` | 0, 0, 0 | 4px, 16px, 26px |
| `--rule-width` | 2px | 1px |
| `--poster-filter` | `grayscale(1) contrast(1.1)` | `sepia(0.6) brightness(0.55)` |

`--font-display` is replaced by `--font-title`. Reviews use `--font-text`; buttons and labels use `--font-label`. Contrast pairs tested: ink/bg, ink-soft/bg, ink/surface, on-accent/accent, accent/bg (as large text), rule/bg (3:1).

### D2. Registry, Automatic and pre-paint
`theme/themes.ts` lists `{ id, name, scheme, themeColor }` for `beton` (light) and `willis` (dark); `resolveTheme(pref, systemDark)` maps `automatic` → beton/willis. The preference lives in `localStorage['cinefilo.appearance']` (`automatic` | theme id; a new frozen identifier, pinned in `src/frozen-ids.test.ts`). A small inline pre-paint script in `index.html` sets `data-theme` and `<meta name="theme-color">` before any module loads; a test runs it against the registry (lector's `prepaint.test.ts` pattern). Automatic listens to `matchMedia('(prefers-color-scheme: dark)')`. The manifest's colours use Willis. `screening-room.css` is deleted.

### D3. Fonts
Vendored woff2, latin and latin-ext subsets, from Fontsource packages (devDependencies used only by a copy script, `scripts/vendor-fonts.mjs`), into `apps/cinefilo/public/fonts/`, with their OFL licence files. `theme/fonts.css` declares them; Workbox precaches latin, latin-ext loads on demand. Families: Archivo (variable), IBM Plex Mono 400/500, Italiana 400, Libre Caslon Display 400, Inter (variable). A size-budget test keeps the precached fonts under 400 KB. No Google Fonts requests.

### D4. Generated covers
`lib/coverArt.ts`: pure `coverSpec(titleId, themeId) → shapes` (rects/lines with positions and token names, never colours), seeded by a stable hash of the id (FNV-1a), so both devices draw the same cover. `Cover.svelte` renders it as inline SVG with `fill="var(--…)"`, `aria-hidden`. Béton: two ink slabs plus one rust bar on `--surface`. Willis: one light slit (`--ink` at reduced opacity plus a glow) at a hashed height on `--surface`. Used in List rows (52×72) and the title screen header (full width). Unit tests: determinism, bounds inside the box, different ids give different specs, token names only.

### D5. Posters option
`localStorage['cinefilo.covers']` = `generated` (default) | `posters` (frozen, guarded). In Settings → Appearance. With `posters`, `Poster.svelte` shows the cached TMDB poster with `filter: var(--poster-filter)`, falling back to the generated cover.

### D6. Theme art
`art/BetonElevation.svelte` and `art/WillisRoom.svelte`: original inline SVG compositions, coloured only with tokens, `aria-hidden`. The welcome screen shows the theme's art; the title screen header shows the title's generated cover at hero size. Art is chosen by the current theme id. No third-party imagery.

### D7. Theme-specific details through CSS only
- Béton numbers the tab labels with a CSS counter ("01 ", "02 ", "03 ") under `[data-theme='beton']`.
- The verdict marks: one `Verdict.svelte` with `data-v="like|meh|dislike"`; each theme styles it (Béton: filled, half and hollow squares; Willis: the word in `--font-text`). Labels stay "Like / Meh / Didn't like" for screen readers.
- "Both loved" mark: a small `--both-loved` dot (Willis) or square (Béton), with an accessible label, in list rows.

These selectors live in a theme-neutral stylesheet (`theme/details.css`) that uses tokens only, so the colour guard still holds.

### D8. Constitution and frozen identifiers
Cinéfilo follows Lector's principles (local-first, no third-party requests at runtime besides TMDB, tests first). New frozen identifiers: `cinefilo.appearance`, `cinefilo.covers`, the theme ids `beton` and `willis` (stored values). Existing frozen identifiers are untouched.

## Risks / Trade-offs

- **Italiana is thin at small sizes** → only used ≥ 20 px, in caps with tracking; everything small uses `--font-label`.
- **Font weight on first load** → latin subsets precached, budget-tested.
- **Posters look commercial** → off by default; when on, desaturated by the theme filter.
