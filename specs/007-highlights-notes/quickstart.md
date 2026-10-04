# Quickstart & Validation: Highlights and Notes (007)

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:convergence && pnpm e2e
cd e2e && npx playwright test highlights extension-highlight capture-highlight --repeat-each=2
```

| # | Scenario | Covers | How |
|---|---|---|---|
| 1 | Normalising quotes and notes: spaces, paragraphs, trimming, the 5,000 cap without truncation | R3, edge cases | core `highlight.test.ts` |
| 2 | Add/Edit/Remove/Restore: rejections and changes, invariants HL-1 to HL-4 | contracts/commands-007 | core `decide.highlight.test.ts` |
| 3 | `textFragment` and `passageUrl` encoding | R4, HL-3 | core; real matching on fixtures in e2e (SC-005) |
| 4 | Migration 3 → 4: rows kept, table present, cursor reset to 0 | data-model | db `migration4.test.ts` |
| 5 | `highlights(itemId)`: order, tombstones, a removed item hides its highlights (H-3); 200 rows under 20 ms | FR-007, SC-006 | db test plus perf |
| 6 | Stats, home and library are unchanged by 100 highlights (H-1) | FR-014 | db test |
| 7 | Remote highlight before its item is parked, then applied | data-model | db `sync.apply.test.ts` |
| 8 | Batches are single-tier; a v3 peer loses no article op and converges after upgrading | R2, sync-tiers | sync `push.test.ts` plus convergence |
| 9 | Relay rows don't contain the quote or the note (raw or base64) | SC-003, constitution II | sync `privacy.test.ts` |
| 10 | Extension: select on a fixture page, then the menu and the command each save; the toast's Add note saves a note; Undo removes the highlight and the article it created; with no selection, nothing is saved | US1, FR-001 to FR-004 | e2e `extension-highlight.spec.ts` |
| 11 | Extension: the saved quote equals the selection on 20 fixture pages | SC-004 | e2e (uses 005's extract fixtures) |
| 12 | Capture link with `quote`: logs the article if needed and adds the highlight; reopening shows "Already saved"; too long saves nothing | US2 | e2e `capture-highlight.spec.ts` |
| 13 | Article screen: list, Show all, Edit note, Remove then Undo, Add highlight, Add note, empty state | US3, US4 | e2e `highlights.spec.ts` |
| 14 | Two contexts: a highlight made on A shows on B after Sync now | SC-003 | e2e (relay fixture) |
| 15 | Accessibility and 320 px layout: the article with highlights in both themes | 006 guards | extend `a11y` and `layout` specs |

## Manual (the user)

1. **Mac:** load the 0.6.0 extension. Select a paragraph, then press ⌥⇧H, add a note,
   and check it in Readerlog.
2. **iPhone:** build "Highlight in Readerlog" (guide). In Chrome, select, Copy, then
   Share. Check in Readerlog.
3. **Jump back:** tap a quote and check the page scrolls to the passage.
