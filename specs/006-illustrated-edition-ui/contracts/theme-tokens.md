# Contract: Theme tokens

A theme is one CSS file, `apps/pwa/src/theme/<id>.css`, containing exactly one rule,
`:root[data-theme='<id>'] { … }`, which sets **every** token below and nothing else.
It also has one entry in `apps/pwa/src/theme/themes.ts`. Screens and components use
**only** these tokens, plus the structural constants in `src/theme/base.css` (spacing,
tap size, fonts, radii, motion).

## Colour tokens (per theme)

| Token | Meaning | Contrast rule (SC-003) |
|---|---|---|
| `--paper` | page background | — |
| `--leaf` | card and grouped-list background | — |
| `--ink` | primary text | ≥ 4.5 on paper and leaf |
| `--ink-soft` | secondary text | ≥ 4.5 on paper and leaf |
| `--rule` | hairlines and separators | — |
| `--accent` | links, current tab, primary buttons | ≥ 4.5 on paper and leaf |
| `--on-accent` | text on accent | ≥ 4.5 on accent |
| `--ornament` | fleurons, drop caps, rules with ornaments | ≥ 3 on paper (graphic) |
| `--butterfly` | butterfly vignette | — |
| `--danger` | destructive text | ≥ 4.5 on paper and leaf |
| `--heat-0` … `--heat-4` | heatmap levels | each step ≥ 1.15 luminance ratio from the previous one |
| `--cloth-1` … `--cloth-6` | generated-cover cloths | `--on-cloth` ≥ 4.5 on each |
| `--on-cloth` | label and border ink on cloth | see above |
| `--bar` | translucent bar tint (usually `--leaf` at 78%) | — |
| `--backdrop` | sheet backdrop | — |
| `--texture` | `none` or a `url(data:…)` paper texture | — |

## Non-colour tokens (per theme)

| Token | Meaning |
|---|---|
| `--scheme` | `light` or `dark`, applied as `color-scheme` |
| `--font-text` | text face stack |
| `--font-display` | display face stack |
| `--radius-group` | grouped-list radius |
| `--radius-sheet` | sheet radius |

## Registry (`themes.ts`)

```ts
export interface Theme { id: string; name: string; scheme: 'light' | 'dark'; swatch: readonly [string, string, string]; themeColor: string }
export const THEMES: readonly Theme[];            // Macondo, Patriarca
export const DEFAULT_LIGHT = 'macondo', DEFAULT_DARK = 'patriarca';
export type Appearance = 'automatic' | Theme['id'];
```

`swatch` and `themeColor` duplicate three token values, for the picker and for the
`theme-color` meta. The token test checks that they equal the CSS values.

## Appearance store (`src/lib/appearance.svelte.ts`)

- `appearance.value: Appearance`, read from `localStorage['readerlog.appearance']`. It
  falls back to `automatic` for a missing, invalid or unreadable value.
- `setAppearance(a)` writes the value (try/catch), sets `document.documentElement.dataset.theme`,
  updates `<meta name="theme-color">`, and updates `color-scheme`.
- Automatic listens to `matchMedia('(prefers-color-scheme: dark)')` changes.
- The pre-paint script in `index.html` applies the same resolution rule, in about 10
  lines, before the stylesheet paints.
