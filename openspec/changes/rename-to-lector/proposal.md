## Why

The monorepo is now **especulati** and will host a second app, cinefilo. The reading log needs its own name (**Lector**) and package names that don't claim the whole repo, before the shared sync code is split out and cinefilo is added. Doing the rename first, by itself, keeps those later changes small and reviewable.

## What Changes

- The visible name changes from Readerlog to **Lector** everywhere a user sees it: the PWA manifest, page title, home-screen title, top bar, Settings, error and sync messages, the extension (name, commands, context menus, options page, toasts), README and docs.
- The code is renamed:
  - the `@readerlog/*` scope becomes `@especulati/*`;
  - `packages/core` → `packages/lector-core`, `packages/db` → `packages/lector-db`;
  - `apps/pwa` → `apps/lector`, `apps/extension` → `apps/lector-extension`;
  - `packages/sync` and `apps/relay` keep their folders and only change scope;
  - `ReaderlogDb` → `LectorDb`, and the root package becomes `especulati`;
  - lint, boundary, test, e2e and CI config follow the new paths.
- **Frozen identifiers stay as they are.** These are the on-device file and storage names, the sync key-derivation salt, the envelope AAD, the pairing-code prefix, the derived-id hash labels and the appearance key. A new guard test locks them, and each one gets a "frozen" code comment.
- Internal extension test hooks (`globalThis.readerlog`, `__readerlogExtract`, `__readerlogToast`, `#readerlog-toast`, the flush alarm) are renamed to `lector`.
- **Spec-kit housekeeping:**
  - remove the `speckit-*` skills and `.specify/` tooling;
  - keep `specs/001–008` and the constitution as history;
  - CLAUDE.md and the implementer agent switch to the openspec workflow;
  - the constitution gets a PATCH note (1.2.1) that it governs lector and that new work uses openspec.

## Capabilities

### New Capabilities

None. This is a rename with no behaviour change (`skip_specs: true`).

### Modified Capabilities

None.

## Impact

- **Storage and wire identifiers:** none change. That's the whole point of the guard test. The ones touched only by comments and the test are:
  - OPFS `/readerlog.db` and `readerlog-sahpool`, and the Web Lock `readerlog-db`;
  - HKDF salt `readerlog-sync-v1`, AAD `readerlog/v1/`, QR prefix `readerlog:sync:1:`;
  - every `readerlog-*-v1/v2` derived-id label;
  - `readerlog.appearance` and `readerlog-fonts`.
- **Deployed URL:** unchanged, so data on every device stays put.
- **Cloudflare Pages build settings:** these live in the dashboard, so the user must point the build command and output directory at `apps/lector` before the merge deploys.
- **Chrome/Brave extension:** an unpacked extension's id comes from its folder path. After the move it has to be loaded again from `apps/lector-extension/dist` and paired again. It is a push-only peer, so no data is lost, but captures made while it is unpaired are refused with a toast.
- **iOS Shortcut:** keeps working, since the URL is unchanged. The docs rename it "Log in Lector", but the user's installed Shortcut keeps whatever name it has.
- **Developer commands:** `pnpm --filter` targets change (`lector`, `@especulati/lector-extension`). CLAUDE.md is updated.

## Out of scope

- Moving lector to a new URL.
- An export format v2. `readerlog/v1` is reserved for the future export (feature 009) and stays as that name.
- Extracting the shared sync code (`extract-shared-sync`).
- Cinefilo (`add-cinefilo`).
