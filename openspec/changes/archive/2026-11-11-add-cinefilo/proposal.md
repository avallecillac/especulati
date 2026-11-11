# Add cinefilo: a shared movies and series tracker

## Why

Two cinephiles track about 200 watched films and 100 "watch later" titles in a shared Google Keep note. At that size the note is messy: there is no structure, no way to filter, and no room for each person's own opinion. Cinefilo replaces it with a local-first app that both of them can edit, where each person keeps an independent score and a short review.

## What Changes

- A new PWA, **cinefilo** (`apps/cinefilo`), with its own Cloudflare Pages project and D1 database (for example `cinefilo.pages.dev`). It is separate from lector: the partner only ever receives cinefilo's URL and sync code.
- A new pure domain package, `packages/cinefilo-core`, where every local write goes through `decide()`. A new storage package, `packages/cinefilo-db`, holds the schema v1, migrations and read models.
- It reuses the shared sync packages from `extract-shared-sync`:
  - field clocks, the change log and the inbox;
  - remote-op apply over a cinefilo allow-list;
  - the encrypted envelope, relay client and engine, with cinefilo's own salt, AAD and QR prefix;
  - the relay handler, mounted through cinefilo's own Pages Functions adapter.
- Titles are **movies and series**. They can be added by hand (works offline), or found through TMDB search. TMDB is optional, and the key is the user's own, stored only on the device.
- The list is shared. Each title has one status: later, watching, watched or dropped. "Watching" and "dropped" apply to series only. A title also has a watched date and, for a series, an optional current season.
- Each member has their own verdict (like, meh or didn't like) and an optional review of at most 1,000 characters. Each member edits only their own, and both are visible to both. Filters include "both liked", "only I rated" and "partner hasn't rated".
- **Sharing:**
  - create a space;
  - invite the partner by code or QR;
  - each device picks "who am I";
  - rename a member;
  - leave or unpair.

  There are no accounts.
- Export as `cinefilo/v1` JSON, and a merge-by-id import of that file.
- Its own token theme, independent of lector's themes.

## Out of scope

- Importing from Google Keep. It will be a later change once the note is structured.
- Ratings per season or per episode, and tracking episodes.
- Rewatch history: v1 keeps a single watched date.
- Accounts, authentication between partners, more than two members as a goal (the model doesn't forbid it), and social features beyond the shared space.
- Moving or changing lector. This change touches **none** of lector's storage or wire identifiers: not the OPFS file or VFS name, the HKDF salt, the envelope AAD, the QR prefix, the derived-id labels, `readerlog/v1` or its localStorage keys. All of cinefilo's identifiers are new and prefixed `cinefilo`.
- Recommendations, streaming availability and push notifications.

## Capabilities

### New Capabilities

- `cinefilo-catalog`: movie and series titles. Covers manual entry offline, optional TMDB search and details with a key kept on the device, posters cached on the device and not synced, and TMDB attribution.
- `cinefilo-watchlist`: the shared status of each title (later, watching, watched, dropped), its watched date and current season, the lists by status, and removing and restoring titles.
- `cinefilo-ratings`: each member's verdict and review, with single-writer ownership, both members visible, and the filters by agreement.
- `cinefilo-sharing`: the sync space, inviting the partner, the member identity on each device, renaming members, leaving or unpairing, encrypted sync, and export.

### Modified Capabilities

None. There are no openspec specs yet, and lector's behaviour does not change.

## Impact

- **New code:** `apps/cinefilo`, `packages/cinefilo-core`, `packages/cinefilo-db`, a cinefilo Pages Functions adapter, and cinefilo e2e suites under `e2e/`.
- **Depends on:** `rename-to-lector` (naming and layout) and `extract-shared-sync` (the generic sync and SQLite plumbing). Cinefilo is the second consumer that justifies that extraction.
- **Infrastructure:** a new Cloudflare Pages project and a new D1 database. Both are created by the user, who also applies the relay schema.
- **External API:** TMDB (api.themoviedb.org and image.tmdb.org), called directly from the browser with the user's key. It is optional, and nothing breaks without it.
- **Dependency rules:** dependency-cruiser gets new boundary rules. `cinefilo-*` must not import lector packages and vice versa, and `cinefilo-core` is held to the same purity rules as lector's core.
- **CI:** typecheck, lint, test, the convergence test and e2e now cover cinefilo too.
