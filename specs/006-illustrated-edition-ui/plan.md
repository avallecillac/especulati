# Implementation Plan: Illustrated-Edition UI and Themes

**Branch**: `claude/reader-log-local-first-0bjykj` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-illustrated-edition-ui/spec.md`

## Summary

Restyle the PWA shell and screens into two things at once:
- an iOS-native feel: large titles, a translucent icon tab bar, back controls, push/pop
  transitions, sheets and press feedback;
- the look of a fine illustrated edition: EB Garamond and Cormorant, running heads,
  drop caps, original SVG ornaments and vignettes, and cloth covers.

All colours, fonts and radii live in per-theme token files, with Macondo (light),
Patriarca (dark) and Automatic. The preference is stored per device in
`localStorage` and applied before first paint.

There are no data, sync or behaviour changes. The existing e2e suite is the regression
net, and new guards cover tokens, contrast, literal colours, accessibility and
overflow.

## Technical Context

| Item | Detail |
|---|---|
| **Language/Version** | TypeScript 5.9, Svelte 5, CSS (custom properties, `color-mix`, `backdrop-filter`, View Transitions) |
| **Primary Dependencies** | None new at runtime. Fonts are vendored woff2 files (OFL), see research R1. Dev only: `@axe-core/playwright` (R6) |
| **Storage** | `localStorage['readerlog.appearance']`, per device. No DB change |
| **Testing** | Vitest (theme tokens, contrast, colour guard, nav depth, appearance resolution); Playwright (shell behaviour, appearance, a11y, 320 px overflow, all existing specs) |
| **Target Platform** | iOS 18 home-screen PWA (primary), Chrome and Brave on macOS |
| **Project Type** | PWA front end only (`apps/pwa`) |
| **Performance Goals** | Theme switch under 100 ms; unchanged write-to-screen time (under 100 ms) and stats time (under 200 ms); fonts plus art under 400 KB |
| **Constraints** | Offline-first (fonts precached); WCAG AA; Reduce Motion and Reduce Transparency respected; no accessible-name changes apart from FR-022 |
| **Scale/Scope** | 19 screens and components, 1 global stylesheet split into base plus themes, and about 6 ornaments |

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I. Local-first | PASS | Fonts and art are bundled and precached, and the theme works offline. Nothing is fetched at runtime |
| II. User owns the data | PASS | No data change. The appearance preference is a device view setting, not user data, so it isn't exported (007 unaffected) |
| III. Events over state | PASS | Untouched |
| IV. Functional core / imperative shell | PASS | Only `apps/pwa`. `packages/core` is untouched. Theme resolution is a pure function in the PWA, unit tested |
| V. Near-zero friction | PASS | No step is added to any capture flow (FR-023). Transitions are at most 350 ms and don't block input |
| VI. Simplicity | PASS, with justification | No runtime dependency: fonts are vendored files, and View Transitions is a platform API. The single dev dependency is `@axe-core/playwright` (R6). The theme abstraction has 2 real themes plus a test theme, so 2 call sites |
| VII. Verified correctness | PASS | Unit guards for tokens, contrast and literal colours; e2e for the shell, appearance, a11y and overflow; the whole existing suite unchanged |
| Technical constraints: performance | PASS | Measured in quickstart (SC-006) |

## Project Structure

### Documentation (this feature)

```text
specs/006-illustrated-edition-ui/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── theme-tokens.md
│   └── ui-shell.md
└── tasks.md
```

### Source Code

```text
apps/pwa/
├── index.html                 # pre-paint theme script, font preload
├── public/fonts/              # EB Garamond + Cormorant woff2 (latin, latin-ext) + OFL.txt
├── vite.config.ts             # precache woff2; manifest colours from Macondo
├── src/
│   ├── app.css                # structure only: layout, lists, sheets, bars (tokens only)
│   ├── theme/
│   │   ├── base.css           # @font-face, spacing, type scale, motion, shared styles
│   │   ├── macondo.css
│   │   ├── patriarca.css
│   │   └── themes.ts          # registry + resolve()
│   ├── lib/
│   │   ├── appearance.svelte.ts
│   │   ├── nav.ts             # parent(route), depth(route)
│   │   └── router.svelte.ts   # view-transition wrapper
│   ├── ornaments/             # Fleuron, Butterfly, Sprig, Fish, Rule, DropCap, TabIcon
│   ├── shell/                 # TopBar.svelte (large/compact title, back), TabBar.svelte
│   └── screens/*.svelte       # restyled; Settings gains Appearance
(tests sit next to the code as src/**/*.test.ts: theme tokens, contrast, colour guard, nav, appearance)
e2e/
├── shell.spec.ts              # large title, back, tab icons, sheet, no-zoom
├── appearance.spec.ts         # picker, persistence, no flash, automatic
├── a11y.spec.ts               # axe in both themes
└── layout.spec.ts             # 320 px overflow on every screen
```

**Structure Decision:** everything is in `apps/pwa`. The new directories are
`src/theme`, `src/ornaments` and `src/shell`. No package boundary changes.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `@axe-core/playwright` (dev) | SC-002 needs an automated a11y scan in both themes | Checking contrast by hand doesn't cover roles and names |
