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

*Filled in after `/speckit-implement`.*
