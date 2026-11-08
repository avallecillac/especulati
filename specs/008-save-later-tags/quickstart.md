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
