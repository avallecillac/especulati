# Implementation Plan: Article Capture

**Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `005-article-capture`) | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-article-capture/spec.md`

## Summary

Articles become first-class items (`type = 'article'`, using existing columns, so
there is no migration). They're added through three paths, all of which go through
`decide()` and sync with feature 004's encryption:

1. **Mac, Chrome and Brave** (research R3, R4, R7): a Manifest V3 extension.
   - A toolbar click, `Alt+Shift+L`, or the context menu runs a Readability-based
     extractor in the page (`activeTab` only).
   - The article is saved through a **push-only capture peer**, with no SQLite and no
     pulling, that shares the batching code with the 004 engine.
2. **iPhone, Chrome** (research R1, R2): a Shortcut fetches the page's readable version
   and opens `…/#/capture?d=…` in Chrome. **Readerlog in Chrome on the iPhone is paired
   as its own sync device**, because iOS home-screen apps can't receive links and keep
   isolated storage. The capture is pushed immediately, and the home-screen app
   receives it on its next sync.
3. **Manual add** by URL in the PWA.

The PWA also gains a Library **Articles** view, an article screen with edit and remove,
and a separate article stats section. Book stats never see articles.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 22. Unchanged.

**Primary Dependencies**:

- New runtime dependency: `@mozilla/readability`, in the extension only (research R4).
- Otherwise: Vite for the extension build (already a dev dependency), WebCrypto,
  `Intl.Segmenter`, and `chrome.*` APIs.

**Storage**:

- PWA: SQLite schema v3, unchanged.
- Extension: `chrome.storage.local` (data-model).

**Testing**:

- Vitest:
  - core: `normalizeUrl` vectors, article commands, `stampOps`, `articleStats`;
  - db: article queries, and book stats unaffected;
  - sync: `capturePeer` with the fake relay, including the no-GET assertion;
  - pwa: capture payload decoding.
- Playwright:
  - PWA capture link, articles and stats;
  - the extension loaded unpacked with `launchPersistentContext`;
  - the extractor over 20 fixture pages.

**Target Platform**: Chrome and Brave on macOS (MV3); Chrome on iOS 17+ (a web page plus
a Shortcut); the installed PWA.

**Project Type**: the existing monorepo, plus the new `apps/extension`.

**Performance Goals**:

- Mac: a toast within 1 s of the click on typical articles.
- A capture reaches the relay within 5 s when online.
- The Articles list stays under 200 ms with 5,000 articles.

**Constraints**:

- No article text is stored or sent (FR-002).
- Only `activeTab` host access.
- The extension never pulls (FR-012).
- Articles are excluded from all book stats (FR-023).

**Scale/Scope**:

- 4 user stories.
- 1 new app (the extension).
- 3 PWA screens: Capture, Articles, Article.
- 3 commands, 1 stats section, and 1 how-to doc for the Shortcut.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Local-first | Every capture saves locally first: in PWA SQLite, or in extension storage. Sending is asynchronous and retried. Offline capture works on both devices (FR-013, US2·3). | PASS |
| II. The user owns the data | Only the URL, title, author, site and word count are stored, never text (FR-002). Everything synced is E2E-encrypted, as in 004 (FR-015, SC-004). The iPhone Shortcut fetches the article only from its own site. **Note:** the extension holds the sync code, so it could decrypt, but by design it never downloads (FR-012). This is accepted in the spec. Export (006) must include articles. | PASS |
| III. Events over state | Articles never create events, and never count toward reading days or streaks. The article stats loader is separate from the books-only loader (FR-023, SC-005). | PASS |
| IV. Functional core, imperative shell | `normalizeUrl`, the article commands, `stampOps` and `articleStats` are pure, in core. DOM extraction, `chrome.*`, fetch and crypto are shell. The extension's writes go through `decide()` too. | PASS |
| V. Near-zero friction | The Mac takes 1 click or key press. The iPhone takes 2 taps after Share. The one-time pairing of Chrome on the iPhone is setup, not per capture (SC-001). | PASS |
| VI. Simplicity | There is no migration. One runtime dependency (Readability) is justified in R4. The capture peer reuses 004's crypto, relay client and push logic (`push.ts` is factored out so there's one implementation). No reading queue, tags or notes. | PASS |
| VII. Verified correctness | URL vectors, command invariants A-1 to A-3, extractor fixtures (SC-003), capture-peer tests with a request log, e2e for every story, and a privacy test extended to articles. | PASS |
| Tech constraints | The Chrome MV3 extension and the web-based iPhone path need no Apple developer account. No migration. | PASS |

**Post-design re-check (after Phase 1):** PASS.

- Contracts: `capture.md` (link, payload, commands, helpers) and `extension.md`
  (manifest, modules, capture sequence, capture peer), each with tests named in the
  quickstart.
- `docs/architecture.md` §8 "Log an article" will be updated for the iPhone path.
  Readerlog in Chrome is a paired device, the link opens in Chrome rather than the
  installed app, and Safari isn't supported.

## Project Structure

### Documentation (this feature)

```text
specs/005-article-capture/
├── plan.md
├── research.md          # R1–R11 (R1: iOS link/storage constraint → Chrome instance as a sync device)
├── data-model.md
├── quickstart.md        # scenarios 1–15, Mac/iPhone setup
├── contracts/
│   ├── capture.md       # capture link + payload, AddArticle/EditArticle/RemoveArticle, pure helpers, URL vectors
│   └── extension.md     # manifest, modules, capture sequence, capturePeer API
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── url.ts              # new: normalizeUrl, siteOf
├── article.ts          # new: Article type, readingMinutes
├── ops.ts              # new: stampOps (shared stamping rule; db's applyChanges keeps its own SQL path)
├── commands.ts / decide.ts   # AddArticle, EditArticle, RemoveArticle; InvalidUrl
└── stats.ts            # + articleStats

packages/db/src/
├── snapshot.ts         # rowToArticle
└── queries.ts          # articles(), article(id), findArticleByUrl(url), loadArticles for stats

packages/sync/src/
├── push.ts             # new: batching + pendingBatch retry, shared by engine.ts and capturePeer.ts
└── capturePeer.ts      # new: push-only peer over a CaptureStore (no packages/db import)

apps/extension/         # new
├── manifest.json, vite.config.ts, package.json
├── src/sw.ts, extract.ts, toast.ts, store.ts, options.ts, options.html
└── test/fixtures/*.html  (20 extractor fixtures)

apps/pwa/src/
├── screens/Capture.svelte     # #/capture?d=…
├── screens/Articles.svelte    # Library → Articles (+ Add article)
├── screens/Article.svelte     # #/article/:id
├── screens/Stats.svelte       # + Articles section
├── lib/capture.ts             # decode payload (std Base64 or base64url), derive the id
└── worker/db.worker.ts, lib/protocol.ts   # article queries

docs/ios-shortcut.md    # step-by-step Shortcut build (FR-017)

e2e/
├── capture-link.spec.ts, articles.spec.ts, article-stats.spec.ts
├── extension-capture.spec.ts, extract.spec.ts
└── fixtures/extension.ts      # launchPersistentContext with --load-extension=apps/extension/dist
```

**Structure Decision**:

- `apps/extension` is its own app. It imports `packages/core`, and
  `packages/sync/src/capturePeer.ts` through a subpath, never `packages/db` or
  `apps/pwa`.
- Dependency-cruiser gets two new rules:
  - `extension-no-pwa-no-db`: `apps/extension` must not import `packages/db` or
    `apps/pwa`;
  - `capture-peer-no-db`: `packages/sync/src/capturePeer.ts` and `push.ts` must not
    import `packages/db`.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| New runtime dependency `@mozilla/readability` (extension only) | An accurate main-content title and word count (SC-003) | A hand-written density heuristic is less accurate, and becomes our own maintenance burden |
| Readerlog in Chrome on the iPhone as a separate paired device | iOS gives home-screen web apps isolated storage and no incoming links (R1) | There is no way to reach the installed app. An unencrypted relay inbox breaks constitution II |
