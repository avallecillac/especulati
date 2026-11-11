# Cinéfilo

A shared movies-and-series tracker for two people. Each phone keeps the whole list in
SQLite (OPFS) and works offline. Changes sync end-to-end encrypted through the same
zero-knowledge relay code as Lector, in a separate space, Pages project and D1 database.

- **Lists:** Watch later, Watching (series), Watched. A series can also be dropped and has
  an optional current season.
- **Ratings:** each person has their own verdict (Like, Meh, Didn't like) and a short
  review (up to 1,000 characters) per title. Each person only edits their own, so ratings
  never conflict.
- **Shared fields** (status, watched date, season, details) use last-writer-wins per field.
  The same film added on both phones offline ends up as one entry (ids are derived from
  the TMDB id, or from the normalized title, year and kind).

Design and requirements: `openspec/changes/add-cinefilo/` (archived under
`openspec/changes/archive/` once shipped; specs merge into `openspec/specs/cinefilo-*`).

## Code

```
packages/cinefilo-core   pure decide(), branded types, reconcile, filters, allow-list, cinefilo/v1 export
packages/cinefilo-db     schema v1 on db-kit, read models, export/import, sync config (frozen strings)
apps/cinefilo            Svelte 5 PWA, DB worker, TMDB client, poster cache, QR scanner
apps/cinefilo/functions  Pages Functions adapter: the shared relay on CINEFILO_RELAY_DB
e2e/cinefilo             Playwright specs (project "cinefilo", preview on port 4174)
```

Frozen identifiers (never change them): `/cinefilo.db`, `cinefilo-sahpool`, `cinefilo-db`,
`cinefilo-changes`, `cinefilo-sync-v1`, `cinefilo/v1`, `cinefilo:sync:1:`,
`cinefilo-title-v1`, `cinefilo-rating-v1`. Guard tests pin each one.

## Commands

```bash
pnpm --filter cinefilo dev     # local dev server
pnpm --filter cinefilo build   # → apps/cinefilo/dist
pnpm test                      # includes cinefilo-core, cinefilo-db, cinefilo
pnpm test:convergence          # lector + cinefilo, 1,000 runs
pnpm e2e                       # lector + cinefilo (run locally before merging)
```

## Deploy

- Cloudflare Pages project `cinefilo`, Git-connected to this repo. Production branch
  `main`; every other branch gets a preview. It rebuilds only when cinefilo or shared code
  changes.
- Build: root directory `apps/cinefilo`, command
  `pnpm install --frozen-lockfile && pnpm --filter cinefilo build`, output `dist`.
  Environment: `NODE_VERSION=22`, `PNPM_VERSION=10.33.0`.
- D1 database `cinefilo-relay`, bound as `CINEFILO_RELAY_DB` in production and preview,
  with `apps/relay/schema.sql` applied.
- Address: `https://cinefilo-6oo.pages.dev` (`cinefilo.pages.dev` was taken). A custom
  domain can be added later in the Pages project.

## Pairing a partner

1. On the first phone, open Cinéfilo, choose **Start a shared list** and enter your name.
   The app shows the code as text and as a QR.
2. On the partner's phone, open the same address, choose **Join with a code**, then
   **Scan code** (or paste the text), and pick **I'm new** with their name.
3. Add Cinéfilo to the Home Screen on both phones (Share → Add to Home Screen). On
   iPhone, the home-screen app has its own storage, so pair it there, not in Safari.

Anyone with the code can read and edit the list and act as either person. To take
access away, use **Settings → Start a new space**; the catalog carries over and the old
code stops receiving changes.

## TMDB

Searching and posters use TMDB with your own key. Create one at
themoviedb.org → Settings → API, then paste the API key (v3) or the read access token
(v4) in **Settings → TMDB** on each phone. The key stays on that phone: it is never
synced, exported or sent anywhere but `api.themoviedb.org`. Without a key, titles are
added by hand. This product uses the TMDB API but is not endorsed or certified by TMDB.
