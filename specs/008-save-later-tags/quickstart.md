# Quickstart & Validation: Save for Later, Tags and Search (008)

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:convergence && pnpm e2e
cd e2e && npx playwright test saved tags search extension-save capture-save --repeat-each=2
```

| # | Scenario | Covers | How |
|---|---|---|---|
| 1 | `tagKey`, `tagName`, `searchKey` (case, spaces, NFKC, accents, 40 characters) | R3, R5 | core |
| 2 | AddArticle without `readOn`, MarkArticleRead (full row, S-2), MarkArticleUnread | commands-008 | core |
| 3 | TagArticle, UntagArticle, RenameTag (plain and merge), DeleteTag, TooManyTags | commands-008, T-1 | core |
| 4 | ReconcileSavedArticle is deterministic (R-1); highlights and tags carried over | R4 | core plus property |
| 5 | `tierOf` for every table and the `read_on: null` case | R2 | core |
| 6 | Migration 4 → 5: tables rebuilt, indexes, cursor reset | data-model | db `migration5.test.ts` |
| 7 | Read models exclude saved articles (S-1); `savedArticles()` is newest first; stats are deep-equal with and without 100 saved | FR-004, SC-003 | db |
| 8 | Search index: terms AND, accents folded, highlight and note matches, tag filter; under 100 ms at 5,000/2,000 | FR-012, FR-013, SC-004 | db perf |
| 9 | Batches are single-tier; a 0.8.0 peer stays healthy (C-1) and converges after upgrading; concurrent tag creation converges (T-2); reconcile converges | R2–R4, SC-006 | sync push plus convergence |
| 10 | Relay rows hold no tag names (raw or base64) | constitution II | sync privacy |
| 11 | Library Saved: list, count, open, Mark as read and Undo, Remove and Undo, empty state | US1, US2 | e2e `saved.spec.ts` |
| 12 | Tags: add (new and suggested), remove, rename, merge, delete; 3 taps for an existing tag | US3, SC-005 | e2e `tags.spec.ts` |
| 13 | Search and filter: title, site, tag, highlight passage shown; AND chips; clear | US4 | e2e `search.spec.ts` |
| 14 | Extension: Save for later (page and link), Add tags, Undo; Log as read on a saved URL marks it read; under 1 s | US1, US2, SC-001 | e2e `extension-save.spec.ts` |
| 15 | Capture link `later`: saves, "Already saved", Add tags; log mode on a saved URL marks it read; highlight mode on a saved URL marks it read | US1, US2, SC-002 | e2e `capture-save.spec.ts` |
| 16 | Reconcile end to end: saved on A, logged by the extension on B, synced; one read article with the highlights and tags | R4, SC-002 | e2e (relay fixture) |
| 17 | a11y and 320 px for Saved, search and tags, in both themes | 006 guards | extend the specs |

## Manual (the user)

1. **Mac:** right-click → Save for later, then Add tags; later, Log as read.
2. **iPhone:** build "Save to Readerlog"; share an article; check Saved.
3. **Search:** search a word from one of your highlights.

## Validation results

### 2026-11-09, dev container, Chromium 141 headless, PWA 0.9.0, extension 0.7.0 (merged to main on 2026-11-09)

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | ✅ 0 errors; no dependency violations |
| `pnpm test` | ✅ 895 tests, 88 files |
| `pnpm test:convergence` | ✅ 13 tests: the 1,000-run test; 007's 0.7.0 peer; a **0.8.0 peer** (100 seeds) that never holds a saved article or tag, never fails to read its DB, keeps every base op and converges after upgrading; R-2 (40 seeds); T-2 concurrent tagging; R-1 deterministic reconcile. Removing the tier break makes the scenarios fail, as it should |
| `pnpm e2e` | ✅ 186/186. `saved`, `capture-save`, `reconcile`, `extension-save`, `tags` and `search` pass with `--repeat-each=2` (94/94) |
| Extension release build | ✅ `check-manifest`: no new permissions, and no test hooks |
| SC-001: save in 1 action, under 1 s | ✅ extension toast 80–125 ms |
| SC-002: one article after save, then log | ✅ capture-save, extension-save, reconcile (two devices, with highlight and tag carried over) |
| SC-003: saved articles don't touch stats | ✅ db deep-equal with 100 saved, plus e2e |
| SC-004: search under 100 ms | ✅ db: first query 70 ms (including the build), warm about 1 ms, at 5,000 articles and 2,000 highlights. UI: about 85 ms at 500 |
| SC-005: existing tag in 3 taps or fewer | ✅ 2 taps |
| SC-006: an old device keeps its data and converges | ✅ convergence (0.8.0 peer, R-2) |
| a11y / 320 px | ✅ Saved, search, All tags and article tags, in both themes: no violations |
| Scenarios 1–17 | ✅ all automated |
| Manual device checks | ✅ 2026-11-09: the user tested on their devices and reported "Tested and working" before the merge |

**Decisions made during review:**
- **Analysis fixes:** F1 (reconcile carries the survivor's full row) and F2 (a saved insert emits `read_on: null` explicitly).
- **`RestoreArticle`:** added for Undo on Remove; it keeps the saved date.
- **Saved's More sheet:** gains Details, which opens the saved article's screen.
- **Tag ids:** reuse a tombstone at `|n`.
- **Duplicate tags:** the rare duplicate-key tag group is accepted as a known limit.
- **`dbClient` `send()`:** a synchronous throw now settles as an error, fixed in its own commit.
- **The search field:** a themed Clear button.
