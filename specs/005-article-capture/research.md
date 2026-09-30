# Research: Article Capture (005)

## R1. iPhone: where a capture link opens (key constraint)

- **Finding**: on iOS, a home-screen web app has its **own isolated storage**, and
  links opened from Shortcuts go to the **default browser**, never to the installed
  web app. So a capture link cannot write into the installed Readerlog's database.
- **Decision**: **Readerlog running in Chrome on the iPhone becomes one more sync
  device.**
  - The user opens the Readerlog site once in Chrome on the iPhone and joins the sync
    space with the sync code (feature 004). This is one-time setup.
  - The Shortcut opens `https://<app>/#/capture?d=…` in Chrome, the default browser.
  - That Chrome instance saves the article locally, then runs a sync **immediately**
    rather than waiting 3 s, so the capture reaches the relay before the tab is
    closed.
  - The installed web app receives it on its next sync: open, brought to the front, or
    the sync button.
- **If the Chrome instance isn't paired**: `/capture` still saves the article locally
  and shows "Finish setup: join your sync space to send this to your other devices",
  with **Join** inline. The capture is kept and is sent once joined.
- **Risk**: WebKit may evict website data after long disuse, and every iOS browser uses
  WebKit.
  - Captures are pushed immediately, so eviction can at worst lose the pairing, not
    data already sent.
  - If the pairing is lost, `/capture` shows the unpaired path above, and nothing is
    lost.
  - The quickstart documents this.
- **Alternatives considered**:
  - A URL scheme into the installed PWA: iOS offers none. Rejected.
  - The Shortcut writes to the relay directly: it would need AES-GCM in Shortcuts,
    which has no such action. Rejected.
  - An unencrypted "inbox" endpoint on the relay: this breaks constitution II.
    Rejected.
  - Using Readerlog only in Chrome on the iPhone, not installed: this works too, and is
    the user's choice. Nothing changes.
- **Prerequisite**: Chrome must be the iPhone's default browser (Settings → Chrome →
  Default Browser App), or the link opens in Safari. The quickstart documents this.

## R2. The iPhone Shortcut

- **Decision**: a user-built Shortcut, "Log in Readerlog", shown in the share sheet for
  **URLs**. Its actions:
  1. Receive a **URL** from the share sheet.
  2. **Get Article using Safari Reader** from that URL. This is a Shortcuts action that
     fetches and parses the page itself, so it works for URLs shared from Chrome.
  3. **Get Details of Article**: Title and Author. **Get Details**: Body, then
     **Count** Words.
  4. **Get Current Date**, formatted as ISO 8601. This is the capture's timestamp.
  5. **Dictionary** `{ v: 1, url, title, author, words, at }`, then **Base64 Encode**,
     then **URL Encode**.
  6. **Open URLs**: `https://<app>/#/capture?d=<encoded>`.
- **Rationale**: every action is built in and no developer account is needed (FR-017).
  The `at` timestamp makes the link idempotent (R5).
- **Limits**: Safari Reader fetches without the user's cookies, so paywalled pages give
  the preview only. If parsing fails, Shortcuts yields an empty body, and `words` is 0
  or missing. The PWA then stores null words (spec US2·2).

## R3. The Mac extension: shape and permissions

- **Decision**: a Manifest V3 extension in a new app folder, `apps/extension`, built
  with Vite into `apps/extension/dist`, and loaded unpacked in Chrome or Brave.
  - **Permissions**: `activeTab`, `scripting`, `contextMenus`, `storage`, and
    `optional_host_permissions: ["https://*/*"]`. The one origin actually used, the
    user's Readerlog site, is requested at pairing time with `chrome.permissions.request`.
    There are **no** broad host permissions.
  - **Capture**:
    1. `chrome.action.onClicked`, the `commands` shortcut `Alt+Shift+L`, or the context
       menu item **Log as read** triggers it.
    2. The service worker runs the bundled extractor in the page with
       `chrome.scripting.executeScript`, which `activeTab` allows.
    3. The page returns `{ url, title, author, words }` only.
  - **Confirmation and Undo**: a small shadow-DOM toast is injected into the page. It
    shows the title and site, "Logged · ~N min", **Undo** for 6 s, and "Already logged
    on <date>" with **Log again** or **Cancel** when relevant. The badge shows the
    number of captures waiting to be sent.
  - **Options page**: set the Readerlog address and paste the sync code, then Pair.
    It also shows the status (paired, waiting count, last sent) and **Unpair**, which
    warns if captures are still waiting.
- **Test-only build** (`EXT_E2E=1`, used only by the e2e fixture): its manifest adds
  `host_permissions: ["http://localhost/*", "http://127.0.0.1/*"]`, so tests can run the
  extractor on localhost fixture pages and reach the local relay without a user gesture
  or a permission prompt. The release build is checked to have **no `host_permissions`**
  at all (`apps/extension/scripts/check-manifest.mjs`, run by `build`).
- **Rationale**:
  - A toolbar click with no popup captures in one click (SC-001).
  - `activeTab` avoids a "read all sites" permission.
  - Brave runs the same MV3 build.

## R4. Extracting details and counting words

- **Decision**: **`@mozilla/readability`** (Apache-2.0, no dependencies, about 30 KB
  minified), run on `document.cloneNode(true)` inside the page.
  - **Title**: Readability's title, else `og:title`, else `document.title`, else the
    site.
  - **Author**: Readability's `byline`, then `meta[name=author]`, then JSON-LD
    `author.name`.
  - **Words**: `Intl.Segmenter(undefined, { granularity: 'word' })` over
    `article.textContent`, counting `isWordLike` segments and capped at 100,000
    (FR-007). If Readability returns nothing, `words = null`.
  - **Non-article pages** (`chrome://`, the Web Store, PDFs, a page with no `http(s)`
    URL): capture is refused with a clear toast or notification.
- **Rationale**: SC-003 needs a real main-content heuristic, and Readability is the
  standard one. `Intl.Segmenter` handles Spanish punctuation correctly. This is the
  one new runtime dependency, and it lives in the extension only (constitution VI).
- **Alternatives**: a hand-written density heuristic is less accurate and becomes our
  own maintenance burden. Rejected.

## R5. Idempotent captures (FR-010) and ids

- **Decision**: the article's id is **derived**,
  `itemId = uuidFromHash("readerlog-capture-v1|" + normalizedUrl + "|" + at)`, where
  `at` is the capture instant, from the Shortcut or the extension.
  - Reopening the same capture link gives the same id, so `AddArticle` answers
    `AlreadyExists` and the UI shows "Already saved" without a second save.
  - Manual adds use a random id, since they have no replay risk.
- **Rationale**: this needs no stored "processed links" state, and it converges across
  devices.

## R6. Address normalization and site (FR-006)

- **Decision**: a pure `normalizeUrl(input): Result<NormalizedUrl, ParseError>` in core.
  It uses a small hand-written parser, not the `URL` global, which is banned in core as
  a shell global. If that proves awkward, the shell parses with `URL` and core
  validates the pieces.
  - Only `http` and `https` are allowed. The scheme and host are lowercased, a default
    port is dropped, and the `#fragment` is dropped.
  - These query parameters are removed: `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`,
    `ref`, `ref_src`, `igshid`, `si`. The rest keep their order.
  - A trailing `/` on the root path is kept as is.
  - **Site** is the host without a leading `www.`.
- **Rationale**: this is deterministic and testable with vectors, and two links to the
  same article compare equal.

## R7. The extension as a push-only sync peer (FR-011–FR-015)

- **Decision**: a new `createCapturePeer(store, deps)` in `packages/sync`. It reuses
  `deriveKeys`, `seal`, `relayClient` and core's `decide` and `hlcNext`. **It has no
  SQLite.**
  - **Store**: `chrome.storage.local` behind a small `CaptureStore` interface (an
    in-memory one in tests). It holds:
    - `deviceId`, `hlc`, `syncKey`, `appOrigin`;
    - `pending: OpWire[]` and `pendingBatch`;
    - `captured: { [normalizedUrl]: { itemId, readOn, removed } }`.
  - **A capture**:
    1. `decide(null, AddArticle)` gives the changes.
    2. The new pure `stampOps(changes, { hlc, deviceId, wallMs, newOpId })` in core
       turns them into `OpWire[]` plus the next HLC, following the same rules as
       `applyChanges`.
    3. The ops are appended to `pending`.
    4. A push-only run follows immediately.
  - **Undo**: `decide(snapshotFromCaptured, RemoveArticle)`, then stamp and push.
  - **Push**: the same batching and idempotent `pendingBatch` logic as the 004 engine
    (research R6 there). The shared part is factored into `packages/sync/src/push.ts`,
    so both use one implementation.
  - **It never calls GET /batches** (FR-012). Its own `captured` map is the only
    knowledge it has.
- **Rationale**: the extension stays small and has no WASM. The PWA engine already
  applies ops from any device, so article creations merge like any other item insert.
- **Security note**: the extension holds the sync code, so it *could* decrypt. The spec
  accepts this (Assumptions). The code lives in `chrome.storage.local`, which only the
  extension can read.

## R8. Article commands (core)

- **Decision**:
  - **`AddArticle { itemId, url, title, author?, wordCount?, readOn, detailsStatus: 'complete' | 'notFound' }`**
    emits an item insert with `type = 'article'`, `url` (normalized), `domain`,
    `title`, `author`, `word_count`, `read_on`, `metadata_status` (`ok` or `failed`)
    and `created_at = now`.
    - Rejections: `TitleRequired`, `InvalidUrl`, `InvalidInput` (for `wordCount` not an
      integer in 0..100000, or a bad `readOn`), and `AlreadyExists`.
  - **`EditArticle { itemId, title?, author?, readOn? }`** follows the unchanged-emits-
    nothing rule, like `EditBook`.
  - **`RemoveArticle { itemId }`** tombstones the item; an already-removed item is a
    no-op.
  - Book commands keep rejecting articles (`liveBook` already checks the type), and
    article commands reject books with `NotFound`.
- **Rationale**: this mirrors the book commands.
  - `word_count` and `read_on` exist since migration 1, so **no migration is needed**.
  - `metadata_status = 'failed'` means "details not fetched" for manual adds (FR-020).

## R9. Duplicate-URL warning (FR-008)

- **PWA**: a `findArticleByUrl(normalizedUrl)` query returns live articles with that
  URL, newest `read_on` first. Capture and manual add check it before dispatching.
- **Extension**: it checks its own `captured` map.
- **Index**: none. Thousands of articles scan in well under 5 ms (constitution:
  measure first). The perf test in T-polish confirms it.

## R10. Articles UI (US3) and stats (US4)

- **Library**: a segmented control, **Books | Articles**. Articles view:
  - It lists live articles by `read_on` desc, then `created_at` desc. Each row shows
    the title, site, date, and "~N min" (`ceil(words / 238)`), or "—".
  - An article screen (`#/article/:id`) offers editing the title, author and date read,
    **Open page** (a new tab, `rel=noopener noreferrer`), and **Remove**.
  - **Add article**: a URL field, then a title prefilled with the site, then Save.
- **Stats**: a new pure `articleStats(articles, { year, today })` in `core/stats.ts`
  gives this week (Monday start), this month, per month for the year, total reading
  minutes (`round(sum(words) / 238)`), and the top 5 sites. It gets its own
  `loadArticles(db)` query, separate from the books-only loader. So SC-005 holds by
  construction, and a test asserts it.

## R11. New dependencies and packages

- **Runtime**: `@mozilla/readability` (extension only).
- **Dev**: none new. Extension e2e uses Playwright's `launchPersistentContext` with
  `--load-extension`, on the preinstalled Chromium.
- **New app folder**: `apps/extension`. Dependency-cruiser gets a new rule:
  `extension-no-pwa` (`apps/extension` must not import `apps/pwa`). It may import
  `packages/core` and `packages/sync`.
- **Migration**: none.
