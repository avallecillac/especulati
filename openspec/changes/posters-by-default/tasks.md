# Tasks

- [x] 1.1 Tests first: e2e `themes.spec.ts` expects posters by default with `filter: none` in both themes and the generated cover as fallback and on request; `appearance.spec.ts` expects "TMDB posters" checked by default and `generated` stored after choosing Generated. Verified they fail on the previous code.
- [x] 1.2 Flip the default in `lib/covers.svelte.ts`, set `--poster-filter: none` in both themes, list "TMDB posters" first in Settings.
- [x] 1.3 Checks: typecheck, eslint, depcruise, `pnpm test`, `pnpm e2e`; merge and confirm the production deploy.
