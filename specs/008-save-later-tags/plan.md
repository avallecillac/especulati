# Implementation Plan: Save for Later, Tags and Search

**Branch**: `claude/reader-log-local-first-0bjykj` | **Date**: 2026-11-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-save-later-tags/spec.md`

## Summary

- **Saved articles** are articles with no read date (R1). New commands handle marking
  read and unread, and capture gains a "later" mode on every path.
- **Tags** are rebuilt as synced tables with name-derived ids, so devices converge
  without merges (R3). They support rename, merge and delete.
- **Search** is an in-memory, accent-folded index in the worker over articles, tags,
  highlights and notes (R5).
- **Duplicates** (a saved URL logged elsewhere) are reconciled automatically and
  deterministically (R4).
- **0.8.0 devices** are protected by two more single-tier batch kinds (tags, and saved
  inserts), and by `MarkArticleRead` carrying a complete row (R2), plus a re-read after
  updating.

## Technical Context

| Item | Detail |
|---|---|
| **Language/Version** | TypeScript 5.9, Svelte 5, SQLite 3.53 WASM |
| **Primary Dependencies** | none new |
| **Storage** | migration 5: `tags` and `item_tags` rebuilt and synced; the index `idx_items_saved` |
| **Testing** | Vitest (core, db, sync including convergence with a 0.8.0 peer); Playwright (PWA, extension, capture link) |
| **Target Platform** | the PWA (iPhone, Mac), Chrome/Brave extension 0.7.0, iOS Shortcut |
| **Performance Goals** | search under 100 ms per keystroke at 5,000 articles and 2,000 highlights; saving confirms in under 1 s |
| **Constraints** | 0.8.0 devices must keep working (they throw on a NULL `read_on`); no article text stored; no new extension permissions |
| **Scale/Scope** | thousands of articles; hundreds of tags; at most 20 tags per article |

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I. Local-first | PASS | Saving, tagging and search all work offline; search is local |
| II. User owns the data | PASS | Tags and saved state are synced encrypted (privacy test), and must be in the 009 export. No article text is stored |
| III. Events over state | PASS | Book events are untouched. Articles have no events; a saved article is a state of the row, which is allowed for articles (005) |
| IV. Functional core | PASS | Every write goes through `decide()`. Ids are derived in the shell. Remote ops go through the allow-list |
| V. Near-zero friction | PASS | Saving is 1 action on the Mac and 2 taps on the iPhone. Tagging is optional and never in the capture path |
| VI. Simplicity | PASS, with justification | No FTS dependency (R5). Reconcile reuses 004's merge pattern; it's justified because the push-only extension can't know about saves made elsewhere |
| VII. Verified correctness | PASS | Core property tests, db, a convergence test with an old peer, and e2e on all paths |
| Schema change | PASS | Migration 5, with a v4 → v5 fixture test |

## Project Structure

```text
packages/core/src/{commands,decide,merge,article,tags(new),search(new)}.ts
packages/db/src/{migrations,queries,snapshot,sync,index,search(new)}.ts
packages/sync/src/{capturePeer,ids}.ts
apps/pwa/src/screens/{Library,Articles,Saved(new),Article,Capture}.svelte, TagInput.svelte(new), TagsSheet.svelte(new), ArticleSearch.svelte(new; Search.svelte is the 002 book search)
apps/pwa/src/lib/{protocol,capture,reconcile(new)}.ts, src/worker/db.worker.ts
apps/extension/{manifest.json, src/sw.ts, src/toast.ts}
docs/ios-shortcut.md
e2e/{saved,tags,search,extension-save,capture-save}.spec.ts
```

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| The `s` tier and a full-row `MarkArticleRead` | 0.8.0 throws on a NULL `read_on`; one saved article would break its Articles and Stats screens | "Update all devices first" can't be enforced; a separate table would duplicate rows and complicate highlights and tags |
| `ReconcileSavedArticle` | The push-only extension can't see saves made on other devices, so duplicates are certain | A prompt adds friction for pairs that are never two different articles |
| Name-derived tag ids | Offline creation on two devices must converge without a merge UI | Random ids would need a dedupe pass and a merge flow |
