---
description: "Task list for 007-highlights-notes"
---

# Tasks: Highlights and Notes for Articles

**Input**: `/specs/007-highlights-notes/`: plan.md, spec.md, research.md (R1–R8),
data-model.md, contracts/ (commands-007, capture-highlight, extension-highlight,
sync-tiers, ui-highlights), quickstart.md

**Tests**: REQUIRED (constitution VII). Write each test first and confirm it fails.

**Execution**: per CLAUDE.md "Model roles", each task or `[P]` batch goes to the
`implementer` agent (Sonnet). The main session reviews, re-runs all checks and commits
after each phase.

**Rules for every task:**

- **`packages/core` is pure:** no DOM, `fetch`, `Date.now`, `new Date`, `Math.random` or
  `crypto.randomUUID`, and no imports from other packages. Ids and dates come in inside
  the command.
- **Writes:** local writes go through `decide()`. Remote ops go through
  `parseRemoteOp`'s allow-list, then `applyRemoteOps`.
- **Constitution v1.2.0:** store only the user's selection, normalised (research R3).
  Never store or send other page text. Never log quotes, notes, the sync code or keys.
- **Caps:** quote and note are each "at most 5,000 characters", "never truncated".
- **The UI** uses tokens only (006 guard test), keeps decorative SVG `aria-hidden`, and
  talks to SQLite only through `dbClient.ts`.
- **Svelte 5 `{@const}` is derived:** read values before clearing state in handlers.
- **e2e:**
  - Custom contexts need `contextOptions: { reducedMotion: 'reduce' }`.
  - Repeat runs use `cd e2e && npx playwright test <spec> --repeat-each=2`, because
    `pnpm e2e --` drops the flag.
  - Port 4173 is shared, so never run two e2e suites at once.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational (blocks every story)

**Purpose:** the data model, commands, sync safety and read model that every capture
path and screen needs.

### Tests first

- [X] T001 [P] Write `packages/core/test/highlight.test.ts` for `normalizeQuote`,
  `normalizeNote`, `textFragment` and `passageUrl`, per research R3 and R4:
  - CRLF/CR become LF;
  - runs of spaces, tabs and NBSP collapse within a line, and each line is trimmed;
  - 3 or more newlines become 2;
  - an empty result is `null`;
  - 5,001 code points give `TooLong { max: 5000 }`, and 5,000 is accepted unchanged;
  - a note keeps its internal spacing but is trimmed and capped;
  - `textFragment` for 8 words or fewer is `#:~:text=<encoded>`; for more it is
    `#:~:text=<first 4>,<last 4>`;
  - `-`, `,`, `&` and `#` are percent-encoded, and line breaks become spaces (HL-3);
  - `passageUrl(url, null) === url`.
- [X] T002 [P] Write `packages/core/test/decide.highlight.test.ts` per
  `contracts/commands-007.md`:
  - **AddHighlight:** the change inserts `highlights` with the normalised quote and
    note, `created_at = now` and the given `local_date`.
  - **AddHighlight rejections:**
    - a missing or removed item gives `NotFound`;
    - both fields empty give `HighlightEmpty`;
    - over 5,000 characters gives `TooLong`;
    - a malformed id or localDate gives `InvalidInput`;
    - `page` on an article gives `InvalidInput { field: 'page' }`;
    - `page` on a book is accepted.
  - **EditHighlightNote:** only `note` changes; clearing the note with no quote gives
    `HighlightEmpty`.
  - **Remove and Restore:** each is idempotent (no changes when already in that state).
  - **Invariants:** HL-1 (the same id twice gives `AlreadyExists`) and HL-4 (Remove then
    Restore gives the original row).
- [X] T003 [P] Extend `packages/core/test/merge.test.ts`:
  - `parseRemoteOp` accepts `tbl: 'highlights'` with the fields `item_id`, `quote`,
    `note`, `page`, `created_at`, `local_date`, `deleted_at`;
  - it rejects any other `highlights` field;
  - `INSERT_FIELDS.highlights` equals `['item_id', 'created_at', 'local_date']`;
  - `tierOf('highlights') === 'h'`, and `'base'` for the other tables.

### Implementation

- [X] T004 Implement core per `contracts/commands-007.md` and data-model.md:
  - `packages/core/src/highlight.ts`, with the types (`Highlight`, `HighlightId`) and
    helpers (`QUOTE_MAX = NOTE_MAX = 5000`);
  - `commands.ts`: the four commands, the rejections `TooLong` and `HighlightEmpty`, and
    `Table` gains `'highlights'`;
  - `decide.ts`: the snapshot carries the highlight row for Edit, Remove and Restore;
  - `merge.ts`: `WRITABLE_FIELDS`, `INSERT_FIELDS`, and `tierOf(tbl)` (`'h'` for
    `highlights`, `'base'` otherwise; in core so db and sync can both import it, since
    db importing sync is circular);
  - `index.ts`: exports.

  T001–T003 must pass, and `pnpm test:convergence` must stay green.
- [X] T005 [P] Write the db tests:
  - `packages/db/test/migration4.test.ts` (new, matching `migration3.test.ts`): a v3 fixture with
    `meta.sync_cursor = '57'` migrates to v4; all rows are kept; `highlights` and
    `idx_highlights_item` exist; `sync_cursor` is `'0'`; and a pre-set
    `sync_status` of `{"undecryptable":3,…}` comes out with `undecryptable` 0 and its
    other fields unchanged.
  - `packages/db/test/highlights.test.ts`:
    - `highlights(itemId)` is ordered by `created_at, id`;
    - tombstoned rows are hidden;
    - a removed item gives `[]`, and its rows are never deleted (H-3);
    - the CHECK constraints reject 5,001 characters and an empty row;
    - H-1: `stats`, `articleStats`, `home` and `library` are deep-equal before and after
      100 highlights.
  - Extend `packages/db/test/sync.apply.test.ts`: a remote highlight whose item hasn't arrived
    is parked in `sync_inbox`, and is applied once the item arrives.
  - Extend `packages/db/test/perf.test.ts`: `highlights(itemId)` with 200 rows takes
    under 20 ms (best of 5).
- [X] T006 Implement db:
  - `migrations.ts`: migration 4, verbatim from data-model.md, so `SCHEMA_VERSION` is 4;
  - `queries.ts`: `highlightsView(db, itemId)`;
  - `index.ts`: `ReaderlogDb.highlights(itemId)`;
  - snapshot loading for the highlight commands (`snapshot.ts`);
  - `sync.ts`: `canInsert` parks a highlight whose `item_id` is missing.

  T005 must pass.
- [X] T007 [P] Write the sync tests:
  - `packages/sync/test/push.test.ts`: change-log ops in the order
    `[items, highlights, highlights, reading_events]` produce the batches `[items]`,
    `[highlights, highlights]` and `[reading_events]`, in order (contracts/sync-tiers.md).
  - Extend `packages/sync/test/convergence.test.ts`:
    - a "v3 peer" rejects any batch containing a `highlights` op, mimicking 0.7.0's
      `parseRemoteOp`;
    - while other peers add articles and highlights, the v3 peer still gets every
      article and event op;
    - after "upgrading" (cursor reset, then full pull), all peers' dumps are identical.
  - Extend `packages/sync/test/privacy.test.ts`: a quote and a note are absent from
    relay rows, both raw and base64.
- [X] T008 Implement the batch tiers: `unpushedOps` in `packages/db/src/sync.ts` ends a
  batch at a tier change, using core's `tierOf` (T004). Don't import `packages/sync`
  from db.

  T007 must pass, and so must the full `pnpm test:convergence`.

**Checkpoint:** highlights can be stored, synced safely and read, with no UI yet.

---

## Phase 2: User Stories 3 and 4 - The Article screen: view, manage, add by hand (P1 / P2) 🎯 MVP

**Goal:** see highlights under an article, open the passage, edit notes, remove with
Undo, and add highlights and notes by hand.

**Why US3 and US4 share a phase:** they live on the same screen, and the e2e tests seed
data through US4's Add.

**Independent Test:** on a logged article:
1. add a quote with a note, and a note on its own;
2. edit, remove, then Undo;
3. check the passage link and the order.

### Tests first

- [X] T009 [P] [US3] Write `e2e/highlights.spec.ts`, per contracts/ui-highlights.md and
  using its accessible names:
  - log an article by URL (005 Add article);
  - **Add highlight** with Quote "First passage" and Note "my thought";
  - **Add note** with "only a note";
  - both are listed, oldest first, with the date in small caps;
  - the quote link's `href` equals `url + '#:~:text=First%20passage'`, with `target`
    `_blank`;
  - **Edit note** changes the text;
  - **Remove** hides the entry, and the toast's **Undo** restores it;
  - a 20-line quote is clamped with **Show all**;
  - an empty Add sheet has Save disabled;
  - the empty state shows its text;
  - **SC-006:** with 200 highlights seeded, the list renders within 200 ms of navigating
    to the article (production build, best of 3).
- [X] T010 [P] [US3] Extend `e2e/a11y.spec.ts` and `e2e/layout.spec.ts` (`e2e/screens.ts`
  seeding): the article screen with 2 highlights, one of them a 120-character unbroken
  quote, in both themes.

### Implementation

- [X] T011 [US3] Worker API:
  - `apps/pwa/src/lib/protocol.ts`: the query `{ name: 'highlights'; itemId }` and the
    four commands;
  - `src/worker/db.worker.ts`: the query and the command dispatch;
  - `src/lib/errors.ts`: messages for `TooLong` ("That passage is too long (5,000
    characters max)") and `HighlightEmpty` ("Add a quote or a note").
- [X] T012 [US3] `apps/pwa/src/screens/HighlightList.svelte`:
  - entries as specified in contracts/ui-highlights.md (blockquote with an ochre rule,
    note, small-caps date, More sheet);
  - Remove shows the toast "Highlight removed · Undo", which runs `RestoreHighlight`;
  - wired into `Article.svelte` under the running head "Highlights", with the empty
    state;
  - reloads on change notifications.
- [X] T013 [US4] `apps/pwa/src/screens/HighlightSheet.svelte`:
  - **Add highlight** (Quote and Note) and **Add note** (Note), plus **Edit note**
    (reusing the sheet);
  - character counter past 4,500, Save disabled when both are empty, the server's
    rejections shown inline;
  - ids from `crypto.randomUUID()`, and `localDate` from `todayLocal()`.

  T009 and T010 must pass.

**Checkpoint:** highlights are fully usable in the app. Review, run all checks, commit.

---

## Phase 3: User Story 1 - Save a highlight from the Mac (P1)

**Goal:** select text, then the menu or ⌥⇧H saves it, with Add note and Undo in the
toast.

**Independent Test:** with the extension paired, save a selection, sync the PWA, and see
it under the article.

### Tests first

- [X] T014 [P] [US1] Extend `packages/sync/test/capturePeer.test.ts` (or create it) for
  `highlight`, `editNote` and `undoHighlight` per contracts/extension-highlight.md:
  - the stamped ops are `AddHighlight`, `EditHighlightNote` and `RemoveHighlight`;
  - `notPaired`, `tooLong` and an empty quote are rejected;
  - flushing pending `[AddArticle, AddHighlight]` posts two batches, in order;
  - the peer never calls `GET /batches`.
- [X] T015 [P] [US1] Write `e2e/extension-highlight.spec.ts`, with the extension loaded
  unpacked (the `EXT_E2E` build) and the relay fixture:
  - select a paragraph on a fixture article (`page.evaluate` sets a Range);
  - trigger the context-menu handler and the command handler through the test hooks;
  - each shows the toast "Highlight saved";
  - **Add note** saves "a note";
  - **Undo** on a fresh page removes both the highlight and the article it created;
  - with no selection, the toast reads "Select some text to highlight" and nothing is
    pending;
  - after flushing, the PWA context syncs and shows the quote and note under the
    article;
  - **SC-004:** on the 20 extract fixtures, a selected paragraph equals the saved quote,
    after normalising;
  - **SC-005:** for each of those quotes, opening `passageUrl(fixtureUrl, quote)` matches
    the passage in at least 18 of 20 (Chromium: the window scrolls, or
    `::target-text` applies);
  - **SC-001:** the toast is visible within 1 s of the trigger;
  - **FR-006:** offline (the relay route aborted), a save is kept pending (the badge
    counts it), and is flushed and visible in the PWA once the relay is back.

### Implementation

- [X] T016 [US1] `packages/sync/src/capturePeer.ts`:
  - `highlight`, `editNote` and `undoHighlight`;
  - the `highlights` map in storage (the newest 2,000);
  - single-tier batches in the peer's flush, using `tierOf`.

  T014 must pass.
- [X] T017 [US1] The extension:
  - `apps/extension/manifest.json`: the `save-highlight` command (Alt+Shift+H), and the
    version becomes 0.6.0;
  - `src/selection.ts`: `readSelection()`, which returns `''` inside `input`,
    `textarea` or `[contenteditable]`;
  - `src/sw.ts`: the context-menu item (`contexts: ['selection']`), the command
    handler and the capture sequence, with test hooks only under `__E2E__`;
  - `src/toast.ts`: the "Highlight saved" state with **Add note** (textarea; Enter or
    Save; Esc cancels) and **Undo** (6 s, held open while the note box is open).

  `scripts/check-manifest.mjs` must still pass: no `host_permissions` and no hooks in the
  release build. T015 must pass.

**Checkpoint:** review, run all checks, commit.

---

## Phase 4: User Story 2 - Save a highlight from the iPhone (P1)

**Goal:** the capture link carries `quote`, and the Shortcut sends the clipboard.

**Independent Test:** open a highlight capture link, and see the article logged (if
needed) with the highlight.

### Tests first

- [X] T018 [P] [US2] Extend `apps/pwa/src/lib/capture.test.ts`:
  - `decodeCapture` returns `quote` and `note`, normalised;
  - a quote over 5,000 characters gives the reason `'quote'`;
  - a missing or empty quote leaves the 005 behaviour unchanged.
- [X] T019 [P] [US2] Write `e2e/capture-highlight.spec.ts` per
  contracts/capture-highlight.md:
  - a link with `quote` for a new URL logs the article and shows "Highlight saved" with
    the quote;
  - reloading the same link shows "Already saved", with one highlight;
  - a link for an already-logged URL adds a highlight with no duplicate prompt;
  - **Add note** saves;
  - **Undo** removes the highlight, and the article if this link created it;
  - a 5,001-character quote saves nothing and names the problem;
  - offline, it saves locally and syncs once back online.

### Implementation

- [X] T020 [US2] Highlight mode:
  - `apps/pwa/src/lib/capture.ts`: `quote` and `note` in `Capture`, the
    `CaptureProblem` value `'quote'`, and `highlightCaptureId(url, at)`;
  - `src/screens/Capture.svelte`: highlight mode, per contracts/capture-highlight.md
    steps 1–5.

  T018 and T019 must pass, and `capture-link.spec.ts` must stay green.
- [X] T021 [US2] `docs/ios-shortcut.md`: a new section, "Highlight in Readerlog",
  covering duplicating, **Get Clipboard**, the `quote` key, Always Allow pasting, and
  use (select, Copy, Share). Add a troubleshooting line.

**Checkpoint:** review, run all checks, commit.

---

## Phase 5: Polish & Cross-Cutting

- [X] T022 [P] Update the docs:
  - `README.md`: the extension's highlight command;
  - `docs/architecture.md`: the `highlights` table, the batch tiers and the cursor reset,
    and add `highlights` to the 008 export row's must-include list (constitution II);
  - `CLAUDE.md`: a "Highlights" rule line.
- [X] T023 Run the full validation (main session):
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm test:convergence && pnpm e2e`,
    plus `--repeat-each=2` on the new specs;
  - quickstart scenarios 1–15;
  - fill in the validation results;
  - bump the PWA to `0.8.0`;
  - build the extension release (`pnpm --filter @readerlog/extension build`) and zip it
    for the user;
  - record the manual device checks as pending.

---

## Follow-ups found during implementation (not in this feature's scope)

- **Bug, from 005:** the capture peer trims `captured` to the newest 5,000 by object key
  order, but `chrome.storage.local` doesn't keep key order. Past 5,000 captured
  articles, it could drop arbitrary entries instead of the oldest. This affects only
  the extension's duplicate warning, and the fix is to trim by `at` (as the 007
  `highlights` map does). It should be its own bug-fix commit, starting with a failing
  test (constitution VII).

## Dependencies & Execution Order

- **Phase 1** blocks everything.
  - T001–T003 run in parallel, then T004.
  - T005 and T007 can be written in parallel with T004, but they pass only after T006
    and T008.
  - T006 needs T004. T008 needs T006, because it is in the same db file.
- **Phase 2** (the Article screen) needs Phase 1. It is the MVP.
- **Phase 3** (the extension) needs Phase 1. Its e2e uses the Article screen to check
  the result, so it runs after Phase 2.
- **Phase 4** (the iPhone) needs Phase 1. Its e2e uses the Article screen, so it runs
  after Phase 2. It can run in parallel with Phase 3: the files don't overlap, but the
  e2e runs must not overlap.
- **Phase 5** comes last.

## Parallel batches (implementer agents)

| Batch | Tasks | Notes |
|---|---|---|
| A | T001, T002, T003 | core tests, separate files |
| B | T004 | core impl |
| C | T005, T007 | db and sync tests |
| D | T006 → T008 | one agent: both touch `packages/db/src/sync.ts`; `tierOf` comes from core (T004) |
| E | T009, T010 → T011 → T012 → T013 | one agent: the Article screen |
| F | T014, T015 → T016 → T017 | one agent: the extension |
| G | T018, T019 → T020 → T021 | one agent: the iPhone path (can run alongside F; e2e runs taken in turn) |
| H | T022 | docs |

## Implementation Strategy

1. **Foundation** (Phase 1): data, commands and safe sync. Nothing visible yet, but
   everything is tested.
2. **MVP** (Phase 2): highlights and notes by hand on the Article screen. That's useful
   on its own, and it is where every capture lands.
3. **Mac capture** (Phase 3), then **iPhone capture** (Phase 4).
4. **Polish and release** (Phase 5): 0.8.0 and extension 0.6.0, merged when the user
   asks.
