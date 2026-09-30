# Quickstart & Validation: Article Capture (005)

## Automated checks

```bash
pnpm typecheck && pnpm lint
pnpm test          # core (url, AddArticle/EditArticle/RemoveArticle, stampOps, articleStats), db (article queries), sync (capturePeer)
pnpm e2e           # PWA: capture link, articles list, stats; extension: loaded unpacked in Chromium
pnpm --filter extension build   # produces apps/extension/dist
```

## Scenarios

| # | Scenario | Covers | How |
|---|---|---|---|
| 1 | Extension: toolbar click on a fixture article page gives a toast with title and "~N min". After a push, the PWA (second context, same relay) lists it dated today | US1·1, SC-002 | e2e `extension-capture.spec.ts` (persistent context with `--load-extension`) |
| 2 | Keyboard shortcut and context menu also capture | FR-003 | e2e, calling the service-worker handlers directly for the context menu |
| 3 | Offline capture goes to pending (badge 1), then is sent when online | US1·3, FR-013 | e2e plus capturePeer unit test |
| 4 | Capturing the same URL again shows "Already logged on …", and **Cancel** saves nothing | US1·4, FR-008 | e2e |
| 5 | Undo within 6 s: the article is gone from the PWA after sync | US1·5, FR-009 | e2e |
| 6 | Pairing from the options page asks for the origin permission and shows "Paired" | US1·6, FR-011 | e2e |
| 7 | The capture peer never requests `GET /batches` | FR-012 | sync unit test (request log) |
| 8 | Extractor fixtures: 20 pages (EN/ES, nav, comments, JSON-LD byline, no title): title correct for 20, words within 15% for at least 18 | SC-003, FR-007 | e2e `extract.spec.ts`, loading the fixture HTML in a page and running `extractPage` |
| 9 | Capture link: a valid link saves an article, dated today; reloading shows "Already saved"; a damaged link saves nothing | US2·1, 4, 7; FR-010, FR-016 | e2e `capture-link.spec.ts` |
| 10 | Capture link while sync is off: saved, and a "Finish setup" join prompt appears | research R1 | e2e |
| 11 | Standard Base64 with line breaks, as Shortcuts produces it, is accepted | contracts/capture.md | pwa unit test |
| 12 | Library → Articles: list, edit title and date, remove, add by URL (title prefilled with the site, "details not fetched") | US3 | e2e `articles.spec.ts` |
| 13 | Article stats: week, month, minutes (3,570 words gives 15 min), top sites | US4 | core unit test plus e2e |
| 14 | Book stats are unchanged by adding 100 articles | SC-005, FR-023 | db test |
| 15 | Relay rows contain no article title or URL | SC-004 | extend 004's privacy.test with an article capture |

## Manual setup and checks

**Mac (Chrome or Brave).** Brave is checked by hand only; e2e runs on Chromium.

1. Run `pnpm --filter extension build`.
2. Open `chrome://extensions` (or `brave://extensions`), turn on **Developer mode**,
   choose **Load unpacked**, and pick `apps/extension/dist`.
3. Open the extension's **Options**. Enter your Readerlog address, paste the sync code
   (from Readerlog → Settings → Sync → Show code), choose **Pair**, and allow the
   permission.
4. On an article, click the toolbar icon. A toast appears. Tap the sync button in the
   Readerlog app, and the article is listed under Library → Articles.

**iPhone (Chrome)**

1. Set Chrome as the default browser: Settings → Apps → Chrome → Default Browser App.
2. In **Chrome**, open your Readerlog address. Go to Settings → Sync → **Join** and paste
   the code. This is a separate device from the home-screen app (research R1).
3. Build the Shortcut "Log in Readerlog" by following
   `docs/ios-shortcut.md` (written in the implementation), and turn on
   **Show in Share Sheet** for URLs.
4. In Chrome, on an article, tap Share → **Log in Readerlog**. Chrome opens Readerlog
   showing "Logged". Open the home-screen Readerlog, tap sync, and the article is there.

## Validation results

### 2026-09-30, dev container, Chromium 141 headless, version 0.5.0

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | ✅ 0 errors; dependency-cruiser finds no violations. The new rules `extension-no-pwa-no-db` and `capture-peer-no-db` are enforced |
| `pnpm test` | ✅ 533 tests, 64 files |
| `pnpm test:convergence` | ✅ 1,000 runs, unchanged after the `push.ts` refactor |
| `pnpm e2e` | ✅ 96/96; the new specs pass **46/46** with `--repeat-each=2` |
| Extension release build | ✅ `check-manifest`: no `host_permissions`, no test hooks, no SQLite in `sw.js` |
| SC-001: 1 click or key on the Mac | ✅ extension-capture.spec (toolbar, command, context menu) |
| SC-002: seen on the other device after Sync now | ✅ extension-capture.spec and capture-link.spec |
| SC-003: extractor accuracy | ✅ titles 20/20, word counts within 15% 20/20, on synthetic EN/ES fixtures |
| SC-004: no article text or details at the relay | ✅ privacy.test (article capture) |
| SC-005: book stats unaffected | ✅ db articles.test: `home`, `library`, `stats`, `duplicates`, `findByIsbn` and `missingCovers` are deep-equal before and after 100 articles |
| SC-006: offline capture on both paths | ✅ the extension (badge, then flush) and the capture link (offline, then online and sync) |
| Performance (R10b) | ✅ with 5,000 articles: first `articles()` page 3 ms, `loadArticles` 35 ms, `findArticleByUrl` 2 ms |
| Scenarios 1–15 | ✅ all automated, apart from Brave, the Show more UI (covered at the db level) and the non-http(s) badge, which can't be triggered headlessly |
| Manual device checks (above) | ⏳ Pending: load the extension on the Mac, pair Readerlog in Chrome on the iPhone, and build the Shortcut |

**Decisions made during review:**
- The toast doesn't wait for the relay.
- Test hooks exist only in the e2e build.
- The Articles list is paged, because copying rows across the WASM boundary dominated at 5,000 articles.
- `articleStats` takes only the fields it reads.
- The perf tests take the best of 5 samples.
