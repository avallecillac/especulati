# Implementation Plan: Highlights and Notes for Articles

**Branch**: `claude/reader-log-local-first-0bjykj` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-highlights-notes/spec.md`

## Summary

Add a synced `highlights` table (migration 4) and four commands through `decide()`:
`AddHighlight`, `EditHighlightNote`, `RemoveHighlight` and `RestoreHighlight`. Pure
helpers normalise quotes and build text-fragment links.

There are three capture paths:
- **The Mac extension:** a selection context-menu item and an ⌥⇧H command, with a toast
  for adding a note.
- **The iPhone:** the 005 capture link gains `quote`. A duplicated Shortcut adds the
  clipboard.
- **By hand:** on the Article screen, which also lists highlights in the 006 edition
  style.

Forward compatibility with devices that haven't updated comes from single-tier sync
batches and a one-time full re-read after the migration (research R2).

## Technical Context

| Item | Detail |
|---|---|
| **Language/Version** | TypeScript 5.9, Svelte 5, SQL (SQLite 3.53 WASM) |
| **Primary Dependencies** | none new |
| **Storage** | SQLite: new synced table `highlights`, migration 4 |
| **Testing** | Vitest (core, no mocks; db against in-memory SQLite; sync incl. convergence), Playwright (PWA, extension loaded unpacked) |
| **Target Platform** | PWA (iPhone home screen, Chrome on the iPhone and the Mac), Chrome/Brave MV3 extension, iOS Shortcut |
| **Project Type** | the existing monorepo: core, db, sync, pwa, extension |
| **Performance Goals** | highlight capture toast under 1 s with no network wait; article screen with 200 highlights under 200 ms |
| **Constraints** | constitution v1.2.0: only the selection is stored; encrypted at the relay; no new extension permissions; old devices must not lose data |
| **Scale/Scope** | up to thousands of highlights; 5,000-character caps |

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I. Local-first | PASS | Every capture writes locally first; sync is optional and offline-safe |
| II. User owns the data | PASS (v1.2.0) | Only explicitly selected text is stored; it's encrypted at the relay (privacy test extended); export 008 must include `highlights` (noted in the roadmap) |
| III. Events over state | PASS | Highlights are their own rows; book status and stats are untouched (H-1) |
| IV. Functional core | PASS | Commands, normalising and fragments live in core and are pure; remote ops go through the `parseRemoteOp` allow-list (v1.1.0 exception) |
| V. Near-zero friction | PASS, with justification | Mac: 1 action after selecting. iPhone: 3 taps (Copy, Share, Shortcut), accepted by the user on 2026-10-04; highlights aren't one of the listed primary capture flows |
| VI. Simplicity | PASS | No dependency. Text fragments are a platform feature. No stored anchor (R4) |
| VII. Verified correctness | PASS | Core, db, sync and convergence tests (including an old-schema peer), plus e2e for all three capture paths |
| Schema change | PASS | Forward-only migration 4, with a v3 → v4 fixture test |

## Project Structure

```text
specs/007-highlights-notes/   plan.md research.md data-model.md quickstart.md contracts/ tasks.md
packages/core/src/highlight.ts              # types, normalizeQuote/Note, textFragment, passageUrl
packages/core/src/{commands,decide,merge}.ts  # 4 commands, Table + allow-lists
packages/db/src/{migrations,queries,sync,index}.ts  # migration 4, highlights() query, parking, tiered unpushedOps
packages/sync/src/{push,capturePeer}.ts     # tierOf, highlight/editNote/undoHighlight
apps/pwa/src/screens/{Article,Capture}.svelte, src/lib/{protocol,capture}.ts, src/worker/db.worker.ts
apps/pwa/src/screens/HighlightList.svelte, HighlightSheet.svelte   # new
apps/extension/{manifest.json, src/sw.ts, src/toast.ts, src/selection.ts}
docs/ios-shortcut.md                        # "Highlight in Readerlog" section
e2e/{highlights,capture-highlight,extension-highlight}.spec.ts
```

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Single-tier batches plus cursor reset | Old devices reject a whole batch with an unknown table and skip it forever, losing article ops mixed in with it | "Update all devices first" can't be enforced; iOS home-screen apps update lazily |
| `RestoreHighlight` command | Undo after Remove (FR-009) | Re-adding with a new id would lose the original's date and order, and duplicate it on other devices |
