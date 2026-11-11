# Tasks

Each group is one commit. "Checks" = `pnpm typecheck`, eslint, depcruise, `pnpm test`, `pnpm --filter cinefilo build`; groups 2–4 also `pnpm e2e` (cinefilo project plus lector unchanged).

## 1. Tokens, fonts and registry

- [ ] 1.1 Tests first: port lector's theme tests to cinefilo — token contract (each theme file sets exactly the D1 tokens in one `:root[data-theme]` rule), WCAG contrast pairs from D1, registry ↔ CSS (`themeColor`), pre-paint script vs registry, colour guard (no literal colours outside `theme/<id>.css`), font size budget (< 400 KB precached). Verify they fail on the current code.
- [ ] 1.2 `scripts/vendor-fonts.mjs` + Fontsource devDependencies; vendor the D3 families into `public/fonts/` with OFL licences; `theme/fonts.css`. Verify: build output contains the fonts, no request to fonts.googleapis.com or fonts.gstatic.com.
- [ ] 1.3 `theme/beton.css`, `theme/willis.css` (D1 values), `theme/themes.ts` (D2), delete `screening-room.css`, update screens from `--font-display` to `--font-title` / `--font-label`. Verify: 1.1 tests pass.
- [ ] 1.4 Pre-paint script in `index.html` and `matchMedia` listener; manifest colours from Willis; `cinefilo.appearance` pinned in `frozen-ids.test.ts`. Verify: checks pass.

## 2. Appearance in Settings

- [ ] 2.1 Settings → Appearance: Automatic / Béton / Willis (radio group, ≥ 44 px), and Covers: Generated / TMDB posters (D5, `cinefilo.covers` pinned). Verify with Playwright: pick Willis in light mode, reload, the first screenshot is Willis (`data-theme` set before `DOMContentLoaded`); Automatic follows `emulateMedia({ colorScheme })`; the choice is not in exports or synced ops.

## 3. Covers, art and details

- [ ] 3.1 Tests first, then `lib/coverArt.ts` (D4) and `Cover.svelte`; replace the letter tiles in List, TitleScreen and AddSheet results.
- [ ] 3.2 `Poster.svelte` posters option with `--poster-filter` and fallback to the generated cover. Verify with the mocked TMDB route: posters off shows the cover; on shows the filtered poster; no poster falls back.
- [ ] 3.3 `art/BetonElevation.svelte`, `art/WillisRoom.svelte` (D6) on the welcome screen; the title screen header uses the hero cover.
- [ ] 3.4 `theme/details.css` (D7): numbered tabs in Béton, `Verdict.svelte`, the both-loved mark. Verify with Playwright: verdict buttons keep their accessible names in both themes.

## 4. Visual check and deploy

- [ ] 4.1 Playwright captures each main screen in both themes at 390×844 to `e2e/cinefilo/__screens__/` (not committed). The main session compares them with the design canvas and fixes differences.
- [ ] 4.2 Full gate (checks + `pnpm test:convergence` + `pnpm e2e`), merge to `main`, confirm the production deploy serves both themes.
