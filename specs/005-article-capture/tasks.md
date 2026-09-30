---

description: "Task list for 005-article-capture"
---

# Tasks: Article Capture

**Input**: Design documents from `/specs/005-article-capture/`

**Prerequisites**: plan.md, spec.md (US1–US4), research.md (R1–R11), data-model.md, contracts/ (capture, extension), quickstart.md

**Tests**: REQUIRED (Constitution VII). Write each test task first and confirm it fails
before implementing it.

**Execution**: per CLAUDE.md "Model roles", each task, or each `[P]` batch, goes to the
`implementer` agent (Sonnet). The main session reviews and commits after each phase.

**Always-applicable rules for every task:**

- **`packages/core` is pure.** Its lib is ES2023 with no DOM, so there is **no `URL`
  global**. `normalizeUrl` is a hand-written parser. The other bans are unchanged: no
  `Date.now`, `new Date`, `Math.random`, `crypto`, or imports from other packages.
- **Every write goes through `decide()`**, including in the extension: the capture peer
  calls core's `decide`, then `stampOps`.
- **No article text is stored or sent anywhere.** Only the URL, title, author, site and
  word count (FR-002).
- **Book stats, book queries and duplicate detection stay books-only.** Existing
  queries already filter `type = 'book'`; keep it that way, and add tests where noted.
- **`apps/extension` must not import `packages/db` or `apps/pwa`.**
  `packages/sync/src/capturePeer.ts` and `push.ts` must not import `packages/db`.
- **No test may call a real network host.** E2e routes `/api/v1/**` through
  `e2e/fixtures/relay.ts`, and extension e2e serves fixture pages from the preview
  server or a `page.route`.
- **Svelte 5 `{@const}` is derived.** Copy values before clearing state.
- **Only one agent may build or run e2e at a time.**

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Scaffold the extension:
  - create `apps/extension`:
    - `package.json` `@readerlog/extension`, with dependencies `@mozilla/readability`
      (pin the current 0.x version) and the workspace packages `@readerlog/core` and
      `@readerlog/sync`;
    - `tsconfig.json` with `lib: ["ES2023", "DOM"]` and `types: ["chrome"]`. Add
      `@types/chrome` as a devDependency here only;
    - `vite.config.ts`, building `sw.ts`, `options.html`, and the injected
      `extract.ts` and `toast.ts` as separate IIFE-safe chunks into `dist/`, plus
      copying `manifest.json`;
    - `manifest.json` exactly as in contracts/extension.md;
    - an **`EXT_E2E=1` test build** (`pnpm --filter extension build:e2e`, output
      `dist-e2e/`) that adds `host_permissions` for `http://localhost/*` and
      `http://127.0.0.1/*` (research R3). The release `build` runs
      `scripts/check-manifest.mjs`, which fails if `dist/manifest.json` has any
      `host_permissions`;
  - add a `build` script (`pnpm --filter extension build`);
  - add `apps/extension/src` to the root `lint` depcruise paths;
  - add dependency-cruiser rules `extension-no-pwa-no-db` and `capture-peer-no-db`
    (plan, Structure Decision);
  - add an `exports` subpath in `packages/sync/package.json` for
    `./capturePeer` (the file is created in T010).

  Run `pnpm install`. `pnpm typecheck`, `pnpm lint` and `pnpm test` must stay green.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: URL normalization, the article commands and read model, `stampOps`,
shared push, and a minimal Articles list, so every story's test can see saved articles.

### Tests first

- [X] T002 [P] Write `packages/core/test/url.test.ts`:
  - every vector in contracts/capture.md, plus: IPv6 hosts are rejected (or not
    supported); `?` with no params is dropped; parameter order is kept; a percent-
    encoded path stays as is;
  - `siteOf` strips only a leading `www.`.
- [X] T003 [P] Write `packages/core/test/decide.articles.test.ts` for `AddArticle`,
  `EditArticle` and `RemoveArticle` (contracts/capture.md table, invariants A-1 to A-3):
  - **`AddArticle`** emits one `items` insert with `type='article'`, the normalized
    `url`, `domain`, `title`, `author` (null when absent), `word_count`, `read_on`,
    `metadata_status` (`ok` for complete, `failed` for notFound), and
    `created_at=now`.
  - **Rejections**:
    - a blank title gives `TitleRequired`;
    - `ftp:`, or not a URL, gives `InvalidUrl`;
    - `wordCount` of -1, 100001 or 1.5 gives `InvalidInput`;
    - a bad `readOn` or `itemId` gives `InvalidInput`;
    - an existing id gives `AlreadyExists`.
  - **`EditArticle`**: an unchanged value emits nothing, and a book id gives
    `NotFound`.
  - **`RemoveArticle`**: a second removal is a no-op, and a book id gives `NotFound`.
  - **Books**: `LogEvent`, `EditBook` and `RemoveBook`-style book commands on an
    article give `NotFound`. Make `RemoveBook` check the type too, as it doesn't today;
    `specs/001-local-book-log/contracts/commands.md` is amended to match.
- [X] T004 [P] Write `packages/core/test/ops.test.ts` for `stampOps`:
  - one op per change;
  - HLCs strictly increase, starting after the given `hlc`, and use `hlcNext`
    semantics with `wallMs` and the device;
  - the op fields equal the change fields;
  - op ids come from `newOpId`.

  Also add a db test proving equivalence: in `packages/db/test/ops.equiv.test.ts`,
  stamping a change list with `stampOps` gives the same `(tbl, row, fields, hlc)`
  sequence that `applyChanges` writes to `change_log`, for the same clock and device.
- [X] T005 [P] Write `packages/db/test/articles.test.ts`:
  - `articles()` returns live articles ordered by `read_on` desc, then `created_at`
    desc, and maps to the `Article` type;
  - `article(id)` returns one;
  - `findArticleByUrl(url)` returns live matches, newest first;
  - **books-only guards**: `home()`, `library()`, `stats()` and `duplicates()` are
    deep-equal before and after inserting 100 articles through `AddArticle` (SC-005).

### Implementation

- [X] T006 Implement the article core in `packages/core`:
  - `src/url.ts`: `normalizeUrl` and `siteOf`;
  - `src/article.ts`: the `Article` type, `WordCount` parsing, and `readingMinutes`;
  - `src/ops.ts`: `stampOps`;
  - the commands in `src/commands.ts` and `src/decide.ts`, with the `InvalidUrl`
    rejection;
  - export them all.

  T002–T004 (core part) must pass, and all existing tests must stay green.
- [X] T007 Implement the article read model in `packages/db`:
  - `rowToArticle`, and the queries `articles()`, `article(id)` and
    `findArticleByUrl()` in `packages/db/src/queries.ts` (plus `ReaderlogDb` methods);
  - `dispatch` loads the single-item snapshot for the article commands. Reuse
    `loadBookSnapshot`, which works for any item; rename it only if trivial.

  T004 (db part) and T005 must pass.
- [X] T008 Factor the push logic out of `packages/sync/src/engine.ts` into
  `packages/sync/src/push.ts`: batching of up to 500, persisting `pendingBatch` before
  POST, resending the same `batchId`, and completing afterwards. It works over a small
  `PushSource` interface: `next(limit)` returns `{ ops, token }` with an opaque
  `token`, then `complete(token)`, `pending()` and `setPending()`.
  - The engine uses it through a `ReaderlogDb` adapter.
  - This is **a refactor with no behaviour change**: all existing sync tests,
    including `pnpm test:convergence`, must pass unchanged.
- [X] T009 Add a minimal Articles list to the PWA:
  - Library gets a **Books | Articles** segmented control (`role="tablist"`).
  - Articles lists title, site, date read and "~N min" (or "—"), from the new worker
    query `articles` in `apps/pwa/src/lib/protocol.ts` and
    `apps/pwa/src/worker/db.worker.ts`.
  - The screen is `apps/pwa/src/screens/Articles.svelte`.
  - **No e2e and no test helpers in the app** in this task. The query is covered by T005,
    and the list is exercised end to end by T012 and T016.

**Checkpoint**: articles can be created, listed and synced like any item.

---

## Phase 3: User Story 1 - Log the article I'm reading on my Mac in one click (Priority: P1) 🎯 MVP

**Goal**: the Chrome/Brave extension captures in one action and pushes through the
relay. The article appears in the PWA after sync.

**Independent Test**: load the unpacked extension, pair it, and capture a fixture page.
The PWA context (on the same routed relay) lists it after **Sync now**.

### Tests for User Story 1

- [ ] T010 [P] [US1] Write `packages/sync/test/capturePeer.test.ts` against the fake
  relay from `packages/sync/test/harness.ts`:
  - **`pair`**:
    - a bad code gives `format` or `checksum`;
    - an unknown space gives `notFound`;
    - success stores `appOrigin` and `syncKey`.
  - **`capture`** stores the ops and pushes them; a PWA peer (`makePeer`) then pulls
    and lists the article.
  - **Push-only**: the request log contains **no** `GET …/batches` (FR-012).
  - **Offline**: a capture waits, `status().waiting` counts it, and a later `flush()`
    sends it.
  - **Crash recovery**: a crash after the relay stored a batch resends the same
    `batchId`.
  - **Duplicates**: a second capture of the same normalized URL returns
    `duplicateOf.readOn`, and `capture({ force: true })` logs it again.
  - **`undo`** emits `RemoveArticle`, and the PWA peer sees it removed.
  - **Idempotency**: two captures with the same `url` and `at` give the same
    `itemId`, and the second is a no-op.
- [ ] T011 [P] [US1] Write the extractor fixtures and tests:
  - 20 HTML files in `apps/extension/test/fixtures/`, in English and Spanish. Include
    news with nav and footer, a blog with comments, a JSON-LD byline, `meta
    name=author`, `og:title` only, no title, a long page (> 100,000 words, to check
    the cap), and a page with no article (for example a product grid).
  - Each fixture has an expected `{ title, author, words }` in
    `apps/extension/test/fixtures/expected.json`, with words counted by hand, or by
    the generator if the article body is generated.
  - `e2e/extract.spec.ts` loads each fixture into a page, injects the built
    `extract.js`, and asserts the title is exact for all 20 and words are within 15%
    for at least 18 (SC-003).
- [ ] T012 [P] [US1] Write `e2e/fixtures/extension.ts` (a persistent-context fixture
  with `--disable-extensions-except` and `--load-extension=apps/extension/dist-e2e`
  (the test build), plus
  the service-worker handle) and `e2e/extension-capture.spec.ts`:
  - **Pairing**: set the origin to the test app origin and paste the code from the PWA
    context's Show code. It reaches "Paired". Grant the permission programmatically if
    the prompt can't be clicked.
  - **Toolbar capture**: trigger the action on a fixture article (call the service
    worker's capture handler for the tab). The toast shows the title and "~N min".
    After **Sync now** in the PWA context, Library → Articles lists it, dated today.
  - **Keyboard and context menu**: the command and context-menu handlers capture too.
  - **Duplicate**: capturing the same page again shows "Already logged on …", and
    **Cancel** adds nothing.
  - **Undo**: the article is removed in the PWA after sync.
  - **Offline**: with the relay routed to fail, the badge shows "1". It's sent once
    the relay works.

### Implementation for User Story 1

- [ ] T013 [US1] Implement `packages/sync/src/capturePeer.ts` per contracts/extension.md.
  It uses `push.ts`, `code.ts`, `keys.ts`, `envelope.ts`, `relayClient.ts`, and core's
  `decide`, `stampOps` and `normalizeUrl`, **with no db import**. `itemId =
  uuidFromHash("readerlog-capture-v1|"+url+"|"+at)`. Move `uuidFromHash` from
  `apps/pwa/src/lib/ids.ts` into `packages/sync/src/ids.ts` and re-export it from the
  pwa module. T010 must pass.
- [ ] T014 [US1] Implement the extension:
  - `apps/extension/src/extract.ts`: Readability, the title and author fallbacks,
    `Intl.Segmenter` word counting, the 100,000 cap, and `null` when nothing is found;
  - `store.ts`: a `CaptureStore` over `chrome.storage.local`;
  - `toast.ts`: a shadow-DOM toast with **Undo** (6 s), **Log again** and **Cancel**;
  - `sw.ts`:
    - the action, command and context-menu handlers;
    - capture through the peer;
    - the badge count;
    - an `alarms` 5-minute flush, and a flush on `onStartup`;
    - it refuses non-http(s) pages with a notification;
  - `options.html` and `options.ts`: pair (with a `chrome.permissions.request` for
    the origin), status, and unpair with a warning if captures are waiting.

  `pnpm --filter extension build` produces a loadable `dist/`. T011 and T012 must
  pass.

**Checkpoint**: Mac capture works end to end. This is the MVP.

---

## Phase 4: User Story 2 - Log an article from Chrome on my iPhone (Priority: P1)

**Goal**: the `/capture` link saves an article in the Readerlog instance that opens it,
and pushes it immediately.

**Independent Test**: open a capture link built like the Shortcut's in a PWA context.
It saves, and a reload doesn't duplicate it.

- [ ] T015 [P] [US2] Write `apps/pwa/src/lib/capture.test.ts` for `decodeCapture(d)`:
  - standard Base64 with `+/`, padding and line breaks, URL-encoded, is accepted;
  - base64url is accepted;
  - `words` of `"1234"` gives 1234, and 0, -3, 100001 and "abc" give null;
  - a missing or bad `url`, or a missing or bad `at`, gives an error;
  - `v: 2` gives an error;
  - the title is trimmed and cut to 500 characters, and an empty title falls back to
    the site;
  - the author is cut to 200 characters.
- [ ] T016 [P] [US2] Write `e2e/capture-link.spec.ts`, with a helper that builds
  links the way the Shortcut does:
  - **a valid link** shows "Logged: <title> · <site> · ~N min", and Library → Articles
    lists it, dated today;
  - **a reload** shows "Already saved", with still one article;
  - **Undo** removes it;
  - **a damaged link** shows "This capture link is damaged" with **Add article**, and
    nothing is saved;
  - **an already-logged URL** (different `at`) shows "Already logged on …" with **Log
    again** or **Cancel**;
  - **with sync on** (two contexts), the article reaches the other context after its
    **Sync now**, without waiting 3 s, because the capture screen runs sync at once;
  - **with sync off**, it's saved, and a "Finish setup" join prompt is shown;
  - **offline** (US2·3, SC-006): with the context offline, the capture saves locally.
    After going online and a sync, the other context has it.
- [ ] T017 [US2] Implement the capture screen:
  - `apps/pwa/src/lib/capture.ts`: `decodeCapture`, and the capture id through
    `uuidFromHash`;
  - `apps/pwa/src/screens/Capture.svelte` for the route `#/capture?d=…`, following the
    sequence in contracts/capture.md;
  - `findArticleByUrl` worker query;
  - an immediate `runSync('manual')` when sync is on.

  T015 and T016 must pass.
- [ ] T018 [US2] Write `docs/ios-shortcut.md`: step-by-step Shortcut creation matching
  research R2, the exact action names, the Base64 and URL-encoding steps, "Show in
  Share Sheet" for URLs, setting Chrome as the default browser, pairing Readerlog in
  Chrome (research R1), and troubleshooting (paywall previews, a lost pairing after
  long disuse). Link it from Settings → Sync ("Log articles from your iPhone") and from
  the README.

---

## Phase 5: User Story 3 - See and manage the articles I've read (Priority: P2)

- [ ] T019 [P] [US3] Extend `e2e/articles.spec.ts`:
  - open an article, edit the title, author and date read, and see the change;
  - **Open page** has `target=_blank` and `rel="noopener noreferrer"`;
  - **Remove** asks for confirmation, and the article is gone;
  - **Add article**: paste a URL; the title is prefilled with the site, and after
    saving the details show "Details not fetched" and "—" for time;
  - adding a URL already logged warns "Already logged on …";
  - edits sync to a second context.
- [ ] T020 [US3] Implement `apps/pwa/src/screens/Article.svelte` (`#/article/:id`:
  view, edit, open, remove) and **Add article** in `Articles.svelte`, dispatching
  `AddArticle` with `detailsStatus: 'notFound'` and a random id. T019 must pass.

---

## Phase 6: User Story 4 - See my article reading stats (Priority: P3)

- [ ] T021 [P] [US4] Write `packages/core/test/stats.articles.test.ts` for
  `articleStats`:
  - 3 articles this week (Monday start) plus 5 earlier this month give `thisWeek` 3
    and `thisMonth` 8;
  - 2,380 plus 1,190 words in the selected year give 15 minutes. Null word counts and
    other years are ignored;
  - top sites are sorted by count desc, then domain asc, at most 5;
  - `months` has 12 entries for the selected year;
  - removed articles are excluded;
  - a week spanning a year boundary is handled.
- [ ] T022 [US4] Implement `articleStats` in `packages/core/src/stats.ts`, and
  `loadArticles` plus `articleStatsView(db, year, today)` in `packages/db/src/stats.ts`
  (**separate** from `loadStatsBooks`). Add the `articleStats` worker query and an
  **Articles** section in `apps/pwa/src/screens/Stats.svelte`: this week, this month,
  per-month counts, reading time as "N h M min", and top sites. Then
  `e2e/article-stats.spec.ts` checks the numbers for seeded articles. T021 must pass.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T023 [P] Extend the privacy test (SC-004): in
  `packages/sync/test/privacy.test.ts`, a capture-peer capture of a distinctive
  article ("Zanzibar Quokka Essay", URL `https://quokka.example/essay-7351`) never
  appears in relay rows, raw or base64-encoded, and the decrypted batch holds only the
  FR-001 fields.
- [ ] T024 [P] Add a performance check: `packages/db/test/perf.test.ts` gets an
  `articles()` case with 5,000 articles (under 50 ms) and a `findArticleByUrl` case
  (under 5 ms).
- [ ] T025 Update the docs (main session): `docs/architecture.md` (the extension and
  capture peer, and the Articles UI), `CLAUDE.md` (the `apps/extension` rules and the
  build command), and the README (extension install).
- [ ] T026 Run the full validation (main session):
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm test:convergence && pnpm e2e`,
    plus `--repeat-each=2` on the new specs;
  - quickstart scenarios 1–15;
  - fill in the quickstart's validation results;
  - bump `apps/pwa` to `0.5.0`, and set `apps/extension` manifest `version` to `0.5.0`.

---

## Dependencies & Execution Order

- **Phase 1**, then **Phase 2**:
  - T002–T005 run in parallel.
  - Then T006, then T007.
  - T008 can run in parallel with T006 and T007 (it's in the sync package).
  - T009 comes after T007.
- **US1** needs Phase 2. **US2** needs Phase 2, and can run alongside US1 on different
  files, but only one agent may run e2e at a time.
- **US3** needs T009. **US4** needs Phase 2.
- **Polish** runs last.

## Parallel batches (for implementer agents)

| Batch | Tasks | Notes |
|---|---|---|
| A | T001 | |
| B | T002, T003, T004, T005 ∥ T008 | tests first. T008 is a refactor, in the sync package |
| C | T006 → T007 → T009 | |
| D | T010, T011, T012 → T013 → T014 | the extension, e2e |
| E | T015 → T017, T016, T018 | the PWA capture screen, e2e, after D's e2e finishes |
| F | T021 → T022 ∥ T019 → T020 | |
| G | T023, T024 | |

## Implementation Strategy

1. **MVP**: Phases 1 and 2, plus US1. Mac capture works end to end.
2. **Next**: US2, iPhone capture. It needs the one-time pairing of Readerlog in Chrome
   on the iPhone.
3. **Then**: US3 (manage and add articles) and US4 (article stats).
4. **Polish**, then release 0.5.0 and merge to `main`.
