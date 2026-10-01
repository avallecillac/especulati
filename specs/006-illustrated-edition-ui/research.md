# Research: Illustrated-Edition UI and Themes (006)

## R1. Typefaces

- **Decision:** bundle two SIL OFL variable fonts, as `woff2` files in
  `apps/pwa/public/fonts/` together with their `OFL.txt`:
  - **EB Garamond** is the text face (weights 400–800, roman and italic).
  - **Cormorant** is the display face, for titles, drop caps and numerals in stats.

  Each face ships a Latin subset (about 35–48 KB per style) and a Latin Extended
  subset, split by `unicode-range`, so the extended subset loads only when it's
  needed.
  - **Latin** (168 KB for 4 files) is precached, so it works offline (spec edge case).
  - **Latin Extended** (264 KB) is fetched on first use and then cached (`CacheFirst`),
    which keeps the first load within the 400 KB budget.
- **Rationale:**
  - Enrico, the typeface García Barcha drew for the edition, isn't licensable. EB
    Garamond is the closest free relative of the Garamond tradition used in Spanish
    literary editions.
  - Cormorant's high contrast gives the display "voice" of an edition's title page.
  - Both cover Spanish accents in the Latin subset.
- **Vendoring vs a dependency:** the files are vendored, with no npm dependency
  (constitution VI: use the platform). They are copied once from
  `@fontsource-variable/*` 5.3.0.
- **Font features:** the subsets have no `smcp` or `onum` features. So:
  - **Small capitals** are made by setting uppercase at 0.78 em with 0.08 em
    letter-spacing (the `.smallcaps` token style). This is the usual web edition
    technique.
  - **Old-style figures** are free: EB Garamond's default figures are old-style.
    `tnum` is available for tables.
- **Loading:** `font-display: swap`, with the fallback stack `'EB Garamond', 'Iowan
  Old Style', 'Palatino', Georgia, serif`. Iowan Old Style ships on iOS and has
  similar metrics, which avoids layout jumps. Only the Latin roman text face is
  preloaded.
- **Alternatives considered:**
  - Spectral: good screen text, but a less bookish colour.
  - Cormorant for body text: too thin at 17 px on a phone.
  - System serif only: no offline control, and the look varies.

## R2. Theme mechanism

- **Decision:** CSS custom properties.
  - Each theme is one CSS file, `src/theme/<id>.css`, that sets every token under
    `:root[data-theme='<id>']`.
  - The registry, `src/theme/themes.ts`, holds `{ id, name, scheme: 'light' | 'dark',
    swatch: [3 colours] }`.
  - The preference `automatic | <id>` lives in `localStorage` under
    `readerlog.appearance`.
  - A tiny inline script in `index.html` sets `data-theme` before the CSS paints (no
    flash, SC-004). Automatic maps to the registry's default light theme or default
    dark theme through `matchMedia('(prefers-color-scheme: dark)')`, with a live
    listener.
- **Why not the DB `meta` table:** the preference is per device and must apply before
  first paint. The DB opens asynchronously in a worker, so it would flash. It is a
  view preference, not user data (constitution II), so it isn't exported or synced.
  If `localStorage` is unavailable (blocked storage), Automatic applies.
- **Token list** (contracts/theme-tokens.md) is the single source. A unit test parses
  every theme file and fails if a token is missing or extra (FR-019, SC-005).
- **Alternatives considered:**
  - A JS object applied with `style.setProperty`: this can't run before paint without
    duplicating the values.
  - Tailwind: a new dependency and a rewrite.

## R3. Palettes (to be checked by the contrast test, SC-003)

**Macondo (light):** paper, verdigris and ochre, after Rivera's greens, blues and ochres.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F3ECDD` | page background |
| `--leaf` | `#FBF7EE` | grouped-list and card background |
| `--ink` | `#2A2419` | text |
| `--ink-soft` | `#6A5F4E` | secondary text |
| `--rule` | `#D9CDB6` | hairlines |
| `--accent` | `#2E6A5C` | verdigris: links, the current tab, primary buttons |
| `--on-accent` | `#FBF7EE` | text on accent |
| `--ornament` | `#A8651F` | ochre: fleurons and drop caps |
| `--butterfly` | `#E0B43A` | yellow butterflies |
| `--danger` | `#9A3226` | danger |
| `--heat-0`…`--heat-4` | `#E7DECB`, `#C2D0B0`, `#98BC9F`, `#5B8F7E`, `#2E6A5C` | heatmap levels |
| `--cloth-1`…`--cloth-6` | verdigris `#2E6A5C`, ochre `#8C5420`, indigo `#33567A`, oxblood `#7A2E2A`, olive `#55602F`, plum `#5A3D5C` | generated covers |

**Patriarca (dark):** night, oxblood and gold, after *El otoño del patriarca*.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#15100E` | page background |
| `--leaf` | `#211916` | grouped-list and card background |
| `--ink` | `#EFE3CC` | text |
| `--ink-soft` | `#A8987E` | secondary text |
| `--rule` | `#3B2E27` | hairlines |
| `--accent` | `#CFA75A` | gold |
| `--on-accent` | `#15100E` | text on accent |
| `--ornament` | `#B8904A` | ornaments |
| `--butterfly` | `#D9B040` | yellow butterflies |
| `--danger` | `#E27B63` | danger |
| `--heat-0`…`--heat-4` | `#33281F`, `#5A2C28`, `#7A302B`, `#A9713A`, `#DDB56A` | heatmap levels |
| `--cloth-1`…`--cloth-6` | oxblood `#6E2424`, bottle green `#24453B`, navy `#1F3148`, brass `#6B5222`, plum `#4A2B3D`, tobacco `#5A3A22` | generated covers |

All values in this table are as shipped in `src/theme/*.css`; `--on-cloth` is `#F6EEDC` (Macondo) / `#EFE3CC` (Patriarca). The contrast test checks `ink`, `ink-soft`, `accent` and `danger` on both `paper` and
`leaf`, and `on-accent` on `accent`, at 4.5:1 or more. The heatmap steps must differ by
at least 1.15:1 luminance ratio (FR-014, distinguishable).

## R4. Native iOS shell techniques

| Behaviour | Technique |
|---|---|
| Large title collapsing into the bar (FR-001) | Each screen's `<h1>` stays in the content. An `IntersectionObserver` on it toggles `data-compact` on the top bar. The compact title is drawn with CSS `content: attr(data-title)`, so it isn't DOM text: e2e text locators and screen readers still see exactly one title |
| Back control (FR-002) | A route → parent map in `src/lib/nav.ts`: book → Library, article → Library (Articles), edit → the book, scan/search/isbn → Add, sync → Settings, duplicates → Sync. It shows "‹ Parent". It uses `history.back()` when the previous entry is that parent, and otherwise navigates to the parent |
| Push/pop transitions (FR-004) | The View Transitions API (Safari 18+, Chrome 111+) wraps the router's state change. Direction comes from route depth (`nav.ts`). Tab switches and same-depth changes don't animate. With Reduce Motion, there's a 150 ms opacity fade on `main` and no view transition. Without the API, the change is instant |
| Translucent bars (FR-003) | `backdrop-filter: saturate(180%) blur(20px)` over `color-mix(in srgb, var(--leaf) 78%, transparent)`, with `@supports not (backdrop-filter…)` and `@media (prefers-reduced-transparency: reduce)` making it solid |
| Sheets (FR-005) | The existing `.sheet` gets a grabber and a `translateY` enter animation. `html.sheet-open { overflow: hidden }` stops the page behind from scrolling |
| No web artefacts (FR-006) | `-webkit-tap-highlight-color: transparent`, `-webkit-touch-callout: none` and `user-select: none` on controls, `touch-action: manipulation`, 17 px or larger inputs (no zoom on focus), and `overscroll-behavior-y: none` on the body with the scroller in `main` |
| Press feedback | `:active` gives `opacity .6` on rows and `transform: scale(.97)` on buttons, over 80 ms |
| Status bar (FR-007) | `theme-color` meta is updated per theme. `apple-mobile-web-app-status-bar-style` stays `default`: iOS then tints the status bar from `theme-color` in standalone mode (iOS 15+) |

- **e2e:** `playwright.config.ts` sets `reducedMotion: 'reduce'` globally, so existing
  specs never click through a view transition overlay. One new spec runs with
  `no-preference` to cover the push animation.
- **Alternatives considered:** a JS animation library, a new dependency ruled out by
  constitution VI; Framework7 or Ionic, which would mean a rewrite.

## R5. Ornaments and vignettes

- **Decision:** original inline SVG components in `src/ornaments/`:
  - `Fleuron` (a stylised leaf-and-scroll);
  - `Butterfly` (a yellow butterfly, a nod to Mauricio Babilonia);
  - `Sprig` (a vine for headpieces);
  - `Fish` (a little golden fish, after the Colonel's goldsmithing);
  - `Rule` (a hairline with a centred fleuron);
  - `DropCapFrame` (a square vine frame behind the drop-cap letter).

  They are drawn as single-colour line art with `currentColor` or `var(--ornament)` /
  `var(--butterfly)`, marked `aria-hidden="true"`, with each file under 2 KB.
- **Rationale:**
  - These are the "illustrated capitals, endpapers and vignettes" of the edition,
    reduced to what a phone screen can carry.
  - Line art (no raster watercolour) keeps the size small and the drawings
    theme-able.
  - They are original drawings, so there's no copyright question.
- **Paper texture** (revised 2026-10-01 at the user's request: "a precious old book that
  gives a cozy feeling"):
  - **Source:** original SVG `feTurbulence` noise tiles in `apps/pwa/public/textures/`
    (each under 1 KB, precached as SVG).
  - **Layering:** they are layered through the `--texture` token, and each layer has a
    different tile size (240, 700 and 900 px), so the repetition doesn't show.
  - **Macondo:** fine grain with faint fibres, large soft age stains, sparse foxing
    freckles, and laid and chain lines (repeating gradients). A warm lamplight vignette
    darkens toward the screen edges. Cards, lists and sheets carry a quieter grain
    (`--leaf-texture`).
  - **Patriarca:** dark grain with faint gold flecks and smoky mottling, under a candle
    glow at the top and deep shadow at the edges.
  - **Contrast:** the vignette sits behind the content (`body::before`, `z-index: -1`),
    so text contrast is unaffected.
  - **Tuning:** the first version's foxing was too strong (it read as stains). It was
    tuned down by eye on device-size screenshots.

## R6. Guards

- **No literal colours (FR-020):** `apps/pwa/src/theme/theme-guard.test.ts` scans
  `src/**/*.svelte` and `src/app.css` for `#rgb`, `#rrggbb`, `rgb(` and `hsl(` outside
  `src/theme/`. The allow-list is `Scan.svelte` / `.scan-*` (camera) and `.qr`, and
  `rgb(0 0 0 / x)` for backdrops.
- **Accessibility scan (SC-002):** `@axe-core/playwright` is added as an e2e **dev**
  dependency (not shipped to users), justified here by constitution VI. `e2e/a11y.spec.ts`
  visits every screen in both themes and fails on serious or critical issues.
- **Overflow at 320 px (SC-007):** e2e sets the viewport to 320 × 640 and checks
  `document.documentElement.scrollWidth <= 320` on every screen.
- **Size budget (SC-006):** a build check sums the fonts and ornament SVG added to the
  precache manifest, and must stay under 400 KB.

## R7. Generated covers as cloth bindings

- **Decision:** `coverHue` becomes `coverCloth(key) → 1..6`, using the same stable hash.
  - The cover background is `var(--cloth-n)`, with a thin inset border in
    `--on-cloth`.
  - A paper title label shows the initials in the display face.
  - A small fleuron sits under the label.
- **Theme behaviour:** changing theme recolours the cloth, while each book keeps its
  cloth index.
- **Tests:** existing cover tests that assert hue are updated to assert the cloth
  index. This is the only test changed in intent, and it's within this spec (FR-021).
