# Quickstart & Validation: Illustrated-Edition UI (006)

## Automated

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

| # | Scenario | Covers | How |
|---|---|---|---|
| 1 | Every theme defines exactly the token list; the swatch and themeColor match | FR-019, SC-005 | `apps/pwa/src/theme/theme-tokens.test.ts` |
| 2 | Contrast pairs meet AA in both themes; heat steps are distinguishable | SC-003, FR-014 | `src/theme/theme-contrast.test.ts` |
| 3 | No literal colours outside `src/theme` (allow-list: QR, camera, backdrop) | FR-020 | `src/theme/theme-guard.test.ts` |
| 4 | `resolve()` for automatic, light, dark, invalid and missing values | FR-017, FR-018 | `src/lib/appearance.test.ts` |
| 5 | `parent()` and `depth()` for every route | FR-002, FR-004 | `src/lib/nav.test.ts` |
| 6 | The large title collapses into the bar on scroll; the tab bar has 5 icons and labels; a book shows "Back to Library", which returns to Library | US1 | `e2e/shell.spec.ts` |
| 7 | The log sheet has a grabber, and the page behind it doesn't scroll | FR-005 | `e2e/shell.spec.ts` |
| 8 | Input font-size is 16 px or more (no iOS zoom); controls have `user-select: none` | FR-006 | `e2e/shell.spec.ts` |
| 9 | With motion allowed, the push to a book runs a view transition | FR-004 | `e2e/shell.spec.ts` (`reducedMotion: 'no-preference'`) |
| 10 | Appearance: pick Patriarca and the page changes at once; reload keeps it with no flash (checked on the first frame); Automatic follows the emulated colour scheme | US3 | `e2e/appearance.spec.ts` |
| 11 | axe finds no serious or critical issues on every screen in both themes | SC-002 | `e2e/a11y.spec.ts` |
| 12 | No horizontal overflow at 320 px on every screen, including long titles | SC-007 | `e2e/layout.spec.ts` |
| 13 | Settings → **Sync settings** opens the Sync screen | FR-022 | the existing sync e2e, updated |
| 14 | Empty states show a vignette; generated covers use the cloth tokens | FR-012, FR-013 | e2e plus a unit test for `coverCloth` |
| 15 | Performance: the stats and write timings stay within budget; fonts plus art are under 400 KB in precache | SC-006 | `e2e/perf.spec.ts` (existing) plus the build-size check |

## Manual (the user, on the iPhone home-screen app)

1. Walk through Home → Library → a book → back → Stats → Settings. Look for any
   web-page artefact: tap flashes, text selection, zoom, jumpy bars (SC-001).
2. Settings → Appearance → Patriarca, then back to Automatic. Toggle iOS dark mode.
3. Turn on Reduce Motion and check the transitions become fades.
