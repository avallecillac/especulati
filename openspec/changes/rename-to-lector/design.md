## Context

See proposal.md (Why) for the motivation. Lector is installed on several devices and paired through an end-to-end-encrypted relay. Its data and its sync both depend on string constants that happen to contain "readerlog". On a browser, a rename that touches the wrong constant either orphans the local database or splits the sync space. Neither failure is visible in tests that start from empty state.

## Goals / Non-Goals

**Goals:**
- Every user-facing string and every package and folder name says Lector or especulati.
- After deploy, every existing device opens with its data intact and keeps syncing with no re-pairing. The only exception is the unpacked extension.
- A test fails if a frozen identifier ever changes.

**Non-Goals:**
- Making `packages/sync` and `apps/relay` domain-agnostic. That's `extract-shared-sync`, which comes next.
- Renaming any storage or wire identifier, even if it can be migrated.

## Decisions

### D1. Frozen identifiers (must not change)

| Constant | Location (today) | Why it's frozen |
|---|---|---|
| `DB_FILE = '/readerlog.db'` | `apps/pwa/src/worker/db.worker.ts:16` | The OPFS file name. Changing it opens an empty database, and the old data is orphaned. |
| `installOpfsSAHPoolVfs({ name: 'readerlog-sahpool' })` | `apps/pwa/src/worker/db.worker.ts:66` | The SAH-pool directory. Changing it orphans the pool, and the data in it. |
| `LOCK = 'readerlog-db'` | `apps/pwa/src/worker/db.worker.ts:15` | During an update, an old tab and a new tab must still exclude each other. Two holders mean two OPFS connections. |
| `CHANNEL = 'readerlog'` | `apps/pwa/src/lib/protocol.ts:122` | The cross-tab BroadcastChannel. During an update, an old tab must still hear a new tab's change notices. |
| `SALT = 'readerlog-sync-v1'` | `packages/sync/src/keys.ts:1` | The HKDF salt. Changing it derives a different `spaceId`, `authToken` and `encKey`, and the device leaves its space. |
| AAD `` `readerlog/v1/${spaceId}/${batchId}` `` | `packages/sync/src/envelope.ts:34` | Changing it makes AES-GCM authentication fail for every existing batch. |
| `QR_PREFIX = 'readerlog:sync:1:'` | `packages/sync/src/code.ts:4` | Existing printed or saved pairing QR codes and codes stop parsing. |
| `readerlog-tag-v1\|` | `packages/db/src/tags.ts:102`, `packages/sync/src/capturePeer.ts:393` | Derived tag ids. If two devices on different versions derive different ids, the same tag ends up as two rows. |
| `readerlog-item-tag-v1\|` | `packages/sync/src/capturePeer.ts:395`, `apps/pwa/src/lib/reconcile.ts:17` | Same as above, for tag assignments. |
| `readerlog-capture-v1\|` (and `\|later`) | `packages/sync/src/capturePeer.ts:311,354`, `apps/pwa/src/lib/capture.ts:107,115` | Capture idempotency. A retried capture must map to the same item. |
| `readerlog-highlight-v1\|` | `packages/sync/src/capturePeer.ts:437`, `apps/pwa/src/lib/capture.ts:111` | Same as above, for highlights. |
| `readerlog-hl-copy-v1\|` | `apps/pwa/src/lib/reconcile.ts:14` | Reconcile must be deterministic across devices. |
| `readerlog-merge-v2\|`, `readerlog-dismiss-v1\|` | `apps/pwa/src/lib/ids.ts:13,16` | Book merges and dismissals must be deterministic across devices. |
| `'readerlog.appearance'` | `apps/pwa/src/lib/appearance.svelte.ts:8`, the pre-paint script in `apps/pwa/index.html:10` | Changing it loses the chosen theme. |
| `cacheName: 'readerlog-fonts'` | `apps/pwa/vite.config.ts:25` | It would be harmless to change (the cache just refills), but it's kept to avoid a pointless re-download. |
| Export format `readerlog/v1` | not in code yet (feature 009) | Reserved. A future v2 must still import v1. |

Each constant gets a `// frozen: storage/wire identifier — see openspec rename-to-lector` comment.

**The guard test.** `packages/sync/test/frozen-ids.test.ts` asserts the sync constants. `apps/lector/src/frozen-ids.test.ts` asserts the worker, appearance and derived-id labels. Both import the real constants, so each one must be exported (or moved into a small `frozen.ts` per package). The test asserts each exact string literal.
- *Alternative rejected:* a grep-based lint rule. It's brittle, and it gives no clear error message.

### D2. Renaming identifiers that are not frozen

**Package scope.** `@readerlog/*` → `@especulati/*`:
- `@especulati/lector-core`
- `@especulati/lector-db`
- `@especulati/sync`
- `@especulati/relay`
- `lector` (the PWA package; it's `pwa` today)
- `@especulati/lector-extension`

**Folders.** Moved with `git mv`, so history follows:
- `packages/core` → `packages/lector-core`
- `packages/db` → `packages/lector-db`
- `apps/pwa` → `apps/lector`
- `apps/extension` → `apps/lector-extension`

`packages/sync` and `apps/relay` stay where they are. They become shared in the next change, so a `lector-` prefix would be wrong.

**Code names.** `ReaderlogDb` → `LectorDb`.

**Config that follows the new paths:**
- `.dependency-cruiser.cjs`: every `^packages/core`, `^packages/db`, `^apps/pwa` and `^apps/extension` rule;
- `eslint.config.js`: the purity block's `files` glob;
- `vitest.config.ts`: project roots, with the project names becoming `lector-core`, `lector-db`, `sync`, `relay` and `lector`;
- every `tsconfig` `references` and `paths`;
- `functions/api/[[path]].ts` imports;
- `e2e/playwright.config.ts`: the webServer command and the extension `dist` path in `e2e/fixtures/extension.ts`;
- `.github/workflows/ci.yml`;
- `apps/lector-extension/scripts/check-manifest.mjs`: its regex, to `\.lector\s*=`.

**Extension test hooks.** The hooks become `globalThis.lector`, `__lectorExtract`, `__lectorToast` and `#lector-toast`, and the alarm becomes `lector-flush`. They're internal: they're only read by the extension itself and by e2e tests. One caveat: an alarm already scheduled under the old name won't fire after an update. The service worker re-creates its alarm on startup, so a stale `readerlog-flush` is simply never handled. That's harmless.

**One commit for the move.** Moving folders and renaming the scope in a single commit keeps every commit green. A partial move breaks the workspace links.

### D3. Visible name

Every user-facing "Readerlog" becomes "Lector". That covers:
- `vite.config.ts` manifest `name` and `short_name`
- `index.html` `<title>` and `apple-mobile-web-app-title`
- `TopBar.svelte`, `Settings.svelte`, `App.svelte`, `errors.ts`, `syncText.ts`
- the extension: `manifest.json` name and command descriptions, `options.html` and `options.ts`, the `sw.ts` toast strings and menu titles
- the docs: `README.md`, `docs/architecture.md`, `docs/ios-shortcut.md`

e2e tests that match these strings are updated in the same commit. The options placeholder becomes the real current URL pattern (`https://<your-lector-address>`). The URL itself is unchanged.

**What doesn't update on its own.** An already-installed iPhone home-screen app keeps its old title until it is added again; iOS captures the manifest name at install time. This is noted in the release notes, not worked around.

### D4. Spec-kit housekeeping

Deleted:
- `.claude/skills/speckit-*` (10 skills);
- `.specify/scripts/`, `.specify/templates/`, `.specify/workflows/`, `.specify/integrations/`, `.specify/init-options.json` and `.specify/integration.json`.

Kept: `specs/001–008/` and `.specify/memory/constitution.md`.

CLAUDE.md:
- the title becomes "especulati";
- it gets a short section per app;
- the workflow section changes to `/openspec-propose` → review → `/openspec-apply-change` → `/openspec-archive-change`;
- the model-roles section stays, with step names replaced;
- the commands follow the new filters.

The implementer agent's description changes from "spec-kit tasks.md during /speckit-implement" to "openspec tasks.md during /openspec-apply-change".

The constitution gets a 1.2.1 PATCH note: it governs Lector, its spec-kit workflow wording is historical, and new work follows openspec.

## Risks / Trade-offs

- **A frozen string gets changed by a blanket find-and-replace** → the guard test lands in the first commit, before any rename. The rename is done per file, never with a repo-wide replace of `readerlog`.
- **The Cloudflare build still points at `apps/pwa`** → the deploy fails and production stays on the old build, so nothing breaks. The user updates the dashboard before merging (task 5).
- **The extension's id changes** → the user has to load and pair it again. No data is lost, because the extension never stores the log.
- **A home-screen title or bookmark still reads "Readerlog"** → this is cosmetic and is noted in the release notes.

## Migration Plan

1. Merge commits 1–4 on a branch, with CI green.
2. The user updates the Cloudflare Pages build settings (root, build command, output `apps/lector/dist`).
3. Merge to `main`, and Pages deploys to the same URL.
4. On each device, open Lector, confirm the library and stats are present, and run a sync.
5. Load the unpacked extension from `apps/lector-extension/dist` and pair it.

**Rollback:** revert the merge. The frozen identifiers are unchanged, so the old build reads the same data.
