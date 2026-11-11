# Tasks

Each numbered group is one commit. "Checks" means that `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` all pass.

## 1. Lock the frozen identifiers (before anything is renamed)

- [x] 1.1 Export every frozen constant in design D1 from its module, or from a small `frozen.ts` next to it, without changing any value. Add a `// frozen: storage/wire identifier — see openspec rename-to-lector` comment to each. Verify: `git diff` shows no change to any string literal; checks pass.
- [x] 1.2 Write `packages/sync/test/frozen-ids.test.ts`. It asserts the HKDF salt, the envelope AAD format (seal under the fixed salt and AAD, then check that a fixture ciphertext from the current build still opens), the QR prefix, and the capture-peer hash labels. Verify: the test passes on the current code, and fails if one literal is changed by hand.
- [x] 1.3 Write `apps/pwa/src/frozen-ids.test.ts`. It asserts `DB_FILE`, the VFS name, the Web Lock name, `readerlog.appearance` (including the pre-paint literal in `index.html`), `readerlog-fonts`, and the `readerlog-*` hash labels in `ids.ts`, `reconcile.ts`, `capture.ts` and `packages/db/src/tags.ts`. Verify: it passes now, and fails on a hand edit; checks pass.

## 2. Move the folders and rename the package scope (one commit)

- [x] 2.1 `git mv packages/core packages/lector-core`, `packages/db packages/lector-db`, `apps/pwa apps/lector`, `apps/extension apps/lector-extension`. Rename the package names per design D2, and set the root `package.json` name to `especulati`. Run `pnpm install` so the lockfile updates. Verify: `pnpm install --frozen-lockfile` succeeds afterwards.
- [x] 2.2 Rewrite every import of `@readerlog/*` as `@especulati/*`. Rename `ReaderlogDb` to `LectorDb`. Verify: `grep -rn "@readerlog/\|ReaderlogDb" --exclude-dir=node_modules --exclude-dir=specs .` returns nothing.
- [x] 2.3 Update `.dependency-cruiser.cjs`, `eslint.config.js`, `vitest.config.ts` (the roots and project names), the tsconfig references, the `functions/api/[[path]].ts` imports, `e2e/playwright.config.ts`, `e2e/fixtures/extension.ts` (the dist path) and `.github/workflows/ci.yml`. Verify: the boundary rules still reject a deliberate `lector-core` → `lector-db` import (try it, then revert it); checks pass.
- [x] 2.4 Rename the extension hooks to `globalThis.lector`, `__lectorExtract`, `__lectorToast`, `#lector-toast` and `lector-flush`. Update `check-manifest.mjs` and the e2e selectors and fixtures to match. Verify: `pnpm --filter @especulati/lector-extension build` rejects a planted `globalThis.lector =` in a release bundle, and accepts the real build; checks pass.
- [x] 2.5 Run the frozen-id guard tests from group 1 at their new paths. Verify: they're unchanged and green.

## 3. Change the visible name to Lector

- [x] 3.1 Update the PWA: the manifest `name` and `short_name`, the `index.html` title and `apple-mobile-web-app-title`, TopBar, Settings, App, `errors.ts` and `syncText.ts`. Update the e2e tests that match these strings. Verify: `grep -rn "Readerlog" apps/lector/src apps/lector/index.html apps/lector/vite.config.ts` returns nothing; checks pass.
- [x] 3.2 Update the extension: the `manifest.json` name and command descriptions, the context-menu titles, `options.html` and `options.ts` (the label "Lector address" and the placeholder `https://<your-lector-address>`), and the `sw.ts` toasts. Update the e2e labels to match. Verify: grep the same way under `apps/lector-extension`; checks pass.

## 4. Update the docs and replace spec-kit with openspec

- [x] 4.1 Update `README.md`, `docs/architecture.md` and `docs/ios-shortcut.md`: the name becomes Lector, the paths change, and the Shortcut becomes "Log in Lector". Add a note that installed Shortcuts keep their name. Verify: no path or filter in the docs refers to a folder that no longer exists (spot-check with `ls`).
- [x] 4.2 Delete `.claude/skills/speckit-*`, plus `.specify/scripts`, `templates`, `workflows`, `integrations`, `init-options.json` and `integration.json`. Keep `specs/` and `.specify/memory/constitution.md`. Verify: `ls .specify` shows only `memory/`.
- [x] 4.3 Rewrite CLAUDE.md as described in design D4: an especulati title, a section per app, the new commands and filters, the openspec workflow, and model roles with openspec step names. Update the description in `.claude/agents/implementer.md`. Verify: every command in CLAUDE.md runs (`pnpm --filter lector dev` starts; the extension build command builds).
- [x] 4.4 Add a PATCH amendment to the constitution (1.2.1, Last Amended 2026-11-11): it governs Lector, and new work follows openspec. Verify: the version line is updated, and no principle text changed.

## 5. User actions before merging

- [ ] 5.1 (User) In the Cloudflare dashboard, set the Pages project build to the new path: the build command `pnpm --filter lector build`, and the output `apps/lector/dist`. The D1 binding `RELAY_DB` stays the same. Verify: a preview deployment of the branch builds successfully.
- [ ] 5.2 (User) After the merge, in `chrome://extensions` (or Brave), remove the old unpacked Readerlog, then load `apps/lector-extension/dist` and pair it again from its Options. Verify: "Log as read" on an article shows the Lector toast.

## 6. Check production after deploy

- [ ] 6.1 Open the unchanged production URL on the Mac and on the iPhone home-screen app. Verify: the library, highlights, tags and stats are all present; the top bar reads "Lector"; Settings → Sync shows a successful sync.
- [ ] 6.2 Capture an article with the extension, and one from the iPhone Shortcut. Verify: both appear on the other devices after sync.
