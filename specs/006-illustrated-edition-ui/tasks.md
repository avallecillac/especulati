---
description: "Task list for 006-illustrated-edition-ui"
---

# Tasks: Illustrated-Edition UI and Themes

**Input**: `/specs/006-illustrated-edition-ui/`: plan.md, spec.md, research.md (R1–R7),
data-model.md, contracts/theme-tokens.md, contracts/ui-shell.md, contracts/visual.md, quickstart.md.

**Tests**: REQUIRED (constitution VII). Write each test first and confirm it fails.

**Rules for every task:**

- **Scope:** only `apps/pwa`, `e2e/`, and the root `package.json` if needed. No change
  to `packages/*`, the DB, sync or the extension.
- **Tokens only:** no literal colour in screens. Use the tokens from
  contracts/theme-tokens.md.
- **Accessible names:** don't change any button, link or heading names that the e2e
  specs use. The only exception is FR-022, "Sync settings".
- **Svelte 5 `{@const}` is derived:** copy values before clearing the state they come
  from.
- **Decoration is hidden:** ornaments carry `aria-hidden="true"`.

## Phase 1: Foundation (blocks everything)

- [X] T001 Vendor fonts:
  - copy the EB Garamond and Cormorant variable woff2 files (latin and latin-ext,
    normal and italic) from `@fontsource-variable/*@5.3.0` into
    `apps/pwa/public/fonts/`, with `OFL.txt`;
  - add `woff2` to the workbox `globPatterns`;
  - preload `eb-garamond-latin-wght-normal.woff2` in `index.html`.
- [X] T002 [P] Tests first, next to the code (`apps/pwa/src/**/*.test.ts`, which is the pwa Vitest include):
  - `theme-tokens.test.ts`: every `src/theme/<id>.css` sets exactly the token list; the
    registry's `swatch` and `themeColor` equal the CSS values;
  - `theme-contrast.test.ts`: the pairs in the contract;
  - `theme-guard.test.ts`: no literal colours outside `src/theme`, apart from the
    allow-list;
  - `appearance.test.ts`: `resolve()`;
  - `nav.test.ts`: `parent()` and `depth()` for every `Route` (written with T005, since `nav.ts` is Phase 2).
- [X] T003 Theme system:
  - `src/theme/base.css`: `@font-face`, type scale, spacing, motion, and the shared
    `.smallcaps` and `.running-head` styles;
  - `src/theme/macondo.css` and `src/theme/patriarca.css` (palettes from research R3);
  - `src/theme/themes.ts`: the registry and `resolve()`;
  - `src/lib/appearance.svelte.ts`;
  - the pre-paint script in `index.html`;
  - move every literal colour out of `app.css` and the screens (including
    `Heatmap.svelte`) into tokens;
  - the manifest's `background_color` and `theme_color` come from Macondo.

  T002 must pass.

## Phase 2: US1, native shell (P1)

- [X] T004 [P] [US1] Write `e2e/shell.spec.ts` (quickstart scenarios 6–9). Set
  `reducedMotion: 'reduce'` in `playwright.config.ts` `use`. Scenario 9 overrides it
  with `test.use`.
- [X] T005 [US1] `src/lib/nav.ts` (`parent` and `depth`, per contracts/ui-shell.md),
  plus the view-transition wrapper in `router.svelte.ts`: set the direction class on
  `<html>`, and skip the transition under Reduce Motion or when the API is missing.
- [X] T006 [US1] `src/shell/TopBar.svelte`:
  - the compact title from `data-title`, driven by an IntersectionObserver on the
    screen's `h1`;
  - the back link;
  - keep the sync button and its accessible name "Sync now".

  `src/shell/TabBar.svelte`: icons (original line SVG), labels unchanged, and a
  translucent blur with a solid fallback.
- [X] T007 [US1] CSS for the native feel:
  - grouped inset lists (`ul.plain`, `.card`) with chevrons on rows that navigate;
  - press feedback;
  - sheets with a grabber and the `sheet-open` scroll lock;
  - no tap highlight or callout, and `user-select: none` on controls;
  - inputs of 17 px or more;
  - safe areas;
  - `overscroll-behavior`.
- [X] T008 [US1] FR-022: the Settings Sync card button becomes "Sync settings". Update
  the e2e specs that click it.

## Phase 3: US2, edition look (P1)

- [X] T009 [US2] Ornaments in `src/ornaments/`: Fleuron, Butterfly, Sprig, Fish, Rule,
  DropCap and the tab icons. They are original line art, and drawn by the main session
  (design).
- [X] T010 [US2] Typography and structure:
  - running heads for every `h2`;
  - the chapter opening on Home's current book and on BookDetail (drop cap, display
    title, small-caps author);
  - stats numerals in the display face with `tnum` in tables;
  - hairline rules with a fleuron between major sections.
- [X] T011 [US2] Empty states with vignettes on Home, Library (books, articles) and
  Stats. Cloth covers: `coverCloth()` in `lib/coverArt.ts` replaces the hue (with a
  unit test), and `Cover.svelte` uses the cloth tokens plus a label and a fleuron.
- [X] T012 [US2] Paper texture token (Macondo only). Heatmap cells use `--heat-*`.

## Phase 4: US3, theme picker (P2)

- [X] T013 [P] [US3] Write `e2e/appearance.spec.ts` (quickstart scenario 10).
- [X] T014 [US3] Settings → Appearance: an inset list of Automatic, Macondo and
  Patriarca, each with a swatch and a check mark, using radio semantics
  (`role="radio"`, `aria-checked`). The change is live.

## Phase 5: US4, themes are palettes only (P3)

- [X] T015 [US4] Add a test-only theme fixture (`apps/pwa/src/theme/test-fixtures/test-theme.css`)
  that passes the token test, proving that a new theme needs only a CSS file and a
  registry entry. Document "Adding a theme" in `docs/architecture.md`.

## Phase 6: Polish

- [X] T016 [P] Write `e2e/a11y.spec.ts`, adding `@axe-core/playwright` as a dev
  dependency, and `e2e/layout.spec.ts` (320 px). Fix what they find.
- [X] T017 Size budget check: fonts plus ornaments in the precache stay under 400 KB.
  The perf e2e stays green.
- [X] T018 Run the full validation (main session):
  - the full suite plus `--repeat-each=2` on the new specs;
  - screenshots of each screen in both themes for the user's review;
  - bump the version to 0.7.0.

## Dependencies

- T001–T003 come first. The US1 tasks (T004–T008) and T009 (ornaments) can run in
  parallel.
- T010–T012 need T009.
- T013 and T014 need T003.
- T016–T018 come last.
