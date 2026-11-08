---
description: "Task list for 008-save-later-tags"
---

# Tasks: Save for Later, Tags and Search

**Input**: `/specs/008-save-later-tags/`: plan.md, spec.md (with Clarifications),
research.md (R1–R6), data-model.md, contracts/ (commands-008, capture-008, ui-008,
sync-tiers-008), quickstart.md

**Tests**: REQUIRED (constitution VII). Write each test first and confirm it fails.

**Execution**: the `implementer` agent (Sonnet) per phase. The main session reviews,
re-runs all checks, and commits after each phase.

**Rules for every task:**

- **`packages/core` is pure.** Ids (including derived tag ids) come in inside commands.
  Derive them in the shell (the worker or the extension service worker) with
  `uuidFromHash`.
- **Writes and remote ops:** local writes go through `decide()`; remote ops go through
  `parseRemoteOp`'s allow-list.
- **0.8.0 safety (research R2):**
  - no pushed batch mixes tiers;
  - `MarkArticleRead` carries the full row;
  - nothing that 0.8.0 reads may produce a `read_on` NULL article on it.
- **Constants:**
  - "Tag names: 1 to 40 characters"; "at most 20 tags per article"; tags are on
    **articles only**.
  - A saved article is `type = 'article' AND read_on IS NULL`, and its saved date is
    `created_at`.
- **The UI:** tokens only (the 006 guard), decorative art `aria-hidden`, accessible names
  per contracts/ui-008.md. The Svelte 5 `{@const}` gotcha applies.
- **e2e:**
  - custom contexts need `contextOptions: { reducedMotion: 'reduce' }`;
  - repeat runs use `cd e2e && npx playwright test <spec> --repeat-each=2`;
  - never run two e2e suites at once.
- **Logging:** never log tag names, quotes, notes, the sync code or keys.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational (blocks every story)

### Tests first

- [X] T001 [P] Write `packages/core/test/tags.test.ts` and
  `packages/core/test/search.test.ts`:
  - **`tagKey`:** NFKC, trim, collapse spaces, lower-case; empty gives `null`.
  - **`tagName`:** trimmed, 1 to 40 characters, otherwise `InvalidInput`.
  - **`searchKey`:** NFD, strip combining marks, lower-case. "Café" gives "cafe",
    "ÑANDÚ" gives "nandu".
  - **`tierOf(tbl, fields)`:** `highlights` gives `h`; `tags` and `item_tags` give `t`;
    an `items` op with `read_on: null` gives `s`; an `items` op with a date, or without
    `read_on`, gives `base`; `reading_events` gives `base`.
- [X] T002 [P] Write `packages/core/test/decide.saved.test.ts` (contracts/commands-008):
  - `AddArticle` without `readOn` inserts with the field **explicitly** present
    (`'read_on' in change.fields` and its value is `null`), and `tierOf` of that change
    is `s` (F2);
  - `MarkArticleRead` emits **every** article insert field plus `read_on` (S-2), and
    gives `AlreadyRead` on a read article and `NotFound` on a book or a removed item;
  - `MarkArticleUnread` sets `read_on: null`, and gives `NotRead` on a saved article.
- [X] T003 [P] Write `packages/core/test/decide.tags.test.ts`:
  - **`TagArticle`:** on a new tag it inserts both the tag and the assignment; with an
    existing tag, only the assignment; a tombstoned assignment is restored; already
    tagged gives no changes.
  - **`TagArticle` rejections:** the 21st tag gives `TooManyTags { max: 20 }`; a book
    item gives `NotFound`; a name of 41 characters gives `InvalidInput`.
  - **`UntagArticle`:** idempotent.
  - **`RenameTag`:** a plain rename sets `name` and `name_key`. A merge requires `moves`
    to equal the source's live assignments, and produces insert/restore `to` plus
    tombstone `from` plus tombstone the source.
  - **`DeleteTag`:** tombstones the tag and every live assignment.
- [X] T004 [P] Write `packages/core/test/decide.reconcile.test.ts`, and extend
  `packages/core/test/merge.property.test.ts`:
  - `ReconcileSavedArticle` checks: same URL, the survivor older, both live articles;
  - the survivor gets the duplicate's `read_on`;
  - highlight copies use content-addressed ids;
  - tag moves;
  - the duplicate gets `deleted_at` plus `merged_into`;
  - **property:** two peers deciding the same reconcile produce deep-equal changes (R-1);
  - **R-2:** the survivor's change carries every article insert field.
- [X] T005 Extend `packages/core/test/merge.test.ts` for the `tags` and `item_tags`
  allow-lists and `INSERT_FIELDS` (data-model.md).

### Implementation

- [X] T006 Implement core:
  - `packages/core/src/tags.ts`: `tagKey`, `tagName`, `TAG_NAME_MAX = 40`,
    `TAGS_PER_ARTICLE_MAX = 20`;
  - `packages/core/src/search.ts`: `searchKey`;
  - `commands.ts`: `AddArticle.readOn` becomes optional, plus the 7 new commands
    (contracts/commands-008), the rejections `AlreadyRead`, `NotRead` and
    `TooManyTags`, and `Table` gains `tags` and `item_tags`;
  - `decide.ts`: the new snapshot shapes, each documented in TSDoc;
  - `merge.ts`: the allow-lists, and `tierOf(tbl, fields)` replacing the 007
    `tierOf(tbl)` (update its callers);
  - `index.ts`.

  T001–T005 must pass, and so must `pnpm test:convergence`.
- [ ] T007 [P] Write the db tests:
  - **`packages/db/test/migration5.test.ts`:** a v4 fixture with an article, a highlight,
    `sync_cursor` and `sync_status`. After migrating: rows kept; the new `tags` and
    `item_tags` with their indexes; `idx_items_saved`; the cursor is `'0'` and
    `undecryptable` is 0.
  - **`packages/db/test/saved.test.ts`:**
    - S-1: `articles()`, `loadArticles`, `articleStats` and `findArticleByUrl` exclude
      saved articles;
    - `savedArticles()` is newest first;
    - `findSavedByUrl`;
    - SC-003: stats are deep-equal with and without 100 saved articles.
  - **`packages/db/test/tags.test.ts`:**
    - `tagsFor(itemId)`;
    - `allTags()` with counts, grouped by `name_key`;
    - `tagSuggestions(prefix)` (most used first);
    - tag id resolution helpers (research R3 steps 1–4).
  - **`packages/db/test/search.test.ts`:**
    - terms AND;
    - accents folded;
    - title, author, domain, tag and highlight/note matches, the latter returning the
      matched passage;
    - the tag filter is AND;
    - read and saved are both included, each labelled;
    - perf, in `packages/db/test/perf.test.ts`: at 5,000 articles plus 2,000 highlights,
      a query with the index built takes under 100 ms (best of 5), and the first query
      including the index build takes under 300 ms.
  - **Extend `packages/db/test/sync.apply.test.ts`:** `item_tags` is parked until both
    its item and its tag exist.
- [ ] T008 Implement db:
  - `migrations.ts`: migration 5, verbatim from data-model.md, so `SCHEMA_VERSION` is 5;
    update `e2e/settings.spec.ts` to expect version 5;
  - `queries.ts`: S-1 filters, `savedArticles`, `findSavedByUrl`, `tagsFor`, `allTags`,
    `tagSuggestions`;
  - `packages/db/src/search.ts`: the index of R5, built lazily, with `invalidate()`;
  - `snapshot.ts`: snapshots for the new commands;
  - `sync.ts`: `canInsert` for `item_tags`; `unpushedOps` uses `tierOf(tbl, fields)`;
  - `index.ts`: `ReaderlogDb` methods.

  T007 must pass.
- [ ] T009 [P] Write the sync tests:
  - **Extend `packages/sync/test/push.test.ts`:** `[items(read), tags, item_tags,
    items(read_on:null), highlights, items(read)]` produces 5 single-tier batches, in
    order.
  - **Extend `packages/sync/test/convergence.test.ts` with an "0.8.0 peer":** it rejects
    whole batches containing `tags`, `item_tags`, or an `items` op with `read_on: null`,
    and parks unknown rows. Across seeds:
    - it never holds an article with `read_on NULL`;
    - R-2: it ends up holding a live, read survivor after a reconcile of a pair where it
      only had the read copy, with no window where the article is missing once the
      reconcile batch is applied;
    - its read models (`articles`, `articleStats`, `home`, `library`, `stats`) never
      throw;
    - it keeps every `base` op;
    - after upgrading (cursor reset, then pull), all dumps are identical.
  - **Extend the convergence test:** concurrent `TagArticle` of the same name on two
    peers gives one tag id (T-2); concurrent reconcile gives identical changes (R-1).
  - **Extend `packages/sync/test/privacy.test.ts`:** tag names are absent from relay
    rows.
- [ ] T010 Fix whatever T009 exposes in the db and sync sources. It must pass with the
  full `pnpm test:convergence`.

**Checkpoint:** the data, commands and safe sync are complete, with no UI yet.

---

## Phase 2: User Story 1 - Save an article for later, in the app and on the iPhone (P1) 🎯 MVP

**Goal:** save from Add article and from the capture link, and see it in Saved.

**Independent Test:** save by URL with **Read later**, and with a `later` capture link.
Both are listed in Saved, newest first, with the count, and stats don't change.

- [ ] T011 [P] [US1] Write `e2e/saved.spec.ts`:
  - Add article with **Read later** lands in Saved (not Articles);
  - the Library "Saved (1)" count;
  - newest first;
  - row content: title, site · ~N min, "Saved <date>";
  - tapping a row opens it in a new tab;
  - **Remove** with Undo;
  - the empty state;
  - Stats unchanged (SC-003, UI level).
- [ ] T012 [P] [US1] Write `e2e/capture-save.spec.ts` (contracts/capture-008, save
  mode):
  - a `later` link saves and shows "Saved for later" with **Undo**;
  - reopening it shows "Already saved";
  - a URL that was already read gets a new saved entry, and the screen says "You read
    this on <date>";
  - offline, it saves locally, then syncs.
- [ ] T013 [US1] Worker and protocol:
  - the queries `savedArticles` and `findSavedByUrl`;
  - the commands;
  - change notifications invalidate the search index.

  Files: `apps/pwa/src/lib/protocol.ts`, `src/worker/db.worker.ts`.
- [ ] T014 [US1] UI:
  - `apps/pwa/src/screens/Saved.svelte`: the list per ui-008, with Remove and Undo;
  - `Library.svelte`: the "Saved (N)" segment;
  - `Articles.svelte`: Add article gains a **Read later** option;
  - `src/lib/capture.ts`: `later` and `tags` keys;
  - `Capture.svelte`: save mode, with the derived id `…|later`.

  T011 and T012 must pass.
- [ ] T015 [US1] `docs/ios-shortcut.md`: a new section, "Save to Readerlog": duplicate
  "Log in Readerlog" and add the Dictionary key `later` (Number) = 1.

**Checkpoint:** review, run all checks, commit.

---

## Phase 3: User Story 2 - Read what I saved (P1)

**Goal:** Mark as read, and every logging path marks a saved URL read instead of
duplicating it. Duplicates from other devices reconcile automatically.

**Independent Test:**
- Mark a saved article as read, then Undo.
- Log a saved URL by capture link, then by highlight link.
- Two contexts: save on A, then log the same URL as a new article on B. After syncing,
  there's one read article carrying both sides' highlights and tags.

- [ ] T016 [P] [US2] Extend `e2e/saved.spec.ts`:
  - **Mark as read** moves the article to Articles, dated today; stats now include it;
    the toast's Undo puts it back in Saved;
  - on the Article screen, a saved article shows "Saved <date>" and a **Mark as read**
    button;
  - **Add highlight** on a saved article marks it read and adds the highlight (FR-006,
    US2 AS5).
- [ ] T017 [P] [US2] Extend `e2e/capture-save.spec.ts`:
  - a log-mode link on a saved URL marks it read ("Logged"), with no new article and no
    "Already logged" prompt;
  - a highlight-mode link on a saved URL marks it read and adds the highlight (007).
- [ ] T018 [P] [US2] Write `e2e/reconcile.spec.ts` (relay fixture, two contexts):
  - A saves a URL and tags it "ai";
  - B logs the same URL as read, with a highlight;
  - both sync;
  - each has exactly one live article, read with B's date, holding the highlight and
    the "ai" tag (SC-002).
- [ ] T019 [US2] Implement:
  - Mark as read, and Mark as unread for Undo (`Saved.svelte`, `Article.svelte`);
  - `HighlightSheet.svelte`: on a saved article, dispatch `MarkArticleRead` before
    `AddHighlight`;
  - `Capture.svelte` log and highlight modes check `findSavedByUrl` first;
  - `apps/pwa/src/lib/reconcile.ts`: after each applied pull page and each local
    article write, find saved/read or saved/saved pairs with the same URL, derive the
    copy ids, and dispatch `ReconcileSavedArticle` (research R4);
  - the worker triggers reconcile after `applyPulledPage`.

  T016–T018 must pass.

**Checkpoint:** review, run all checks, commit.

---

## Phase 4: User Stories 1 and 2 on the Mac - Extension 0.7.0 (P1)

**Goal:** Save for later from the menu (page or link) and ⌥⇧S, with Add tags and Undo.
Log as read on a URL the extension saved marks it read.

- [ ] T020 [P] [US1] Extend `packages/sync/test/capturePeer.test.ts`:
  - `save()` stamps `AddArticle` with `read_on: null` explicitly (F2), and records
    `captured.saved`;
  - `highlight()` on a `captured.saved` entry stamps `MarkArticleRead` (full row) before
    `AddHighlight` (FR-006);
  - `capture()` on a saved entry stamps `MarkArticleRead` with the full row;
  - `tag()` stamps `TagArticle`, with ids derived in the shell;
  - flushes are single-tier per `tierOf`.
- [ ] T021 [P] [US1] Write `e2e/extension-save.spec.ts`:
  - Save for later from the page (command and menu) and from a link (URL only, the
    site as title);
  - the toast "Saved for later" in under 1 s (SC-001);
  - **Add tags** "ai, design" adds both;
  - **Undo** removes it;
  - Log as read on the same page marks it read (one article);
  - ⌥⇧H on a page the extension saved marks it read and adds the highlight;
  - the **Log as read** toast also offers **Add tags** (FR-011);
  - the PWA context shows the results after sync;
  - offline, it stays pending, then flushes.
- [ ] T022 [US1] Implement:
  - `packages/sync/src/capturePeer.ts`: `save`, `tag`, mark-read inside `capture`;
  - `apps/extension/manifest.json`: version 0.7.0, the `save-for-later` command
    Alt+Shift+S;
  - `src/sw.ts`: the menu item "Save for later", `contexts: ['page', 'link']`;
  - `src/toast.ts`: the "Saved for later" state with **Add tags** (a comma-separated
    input) and **Undo**, plus **Add tags** on the existing "Logged" state;
  - in the highlight path: a saved entry is marked read first.

  `check-manifest` must pass (no new permissions, no hooks in the release build), and
  so must T020 and T021.

**Checkpoint:** review, run all checks, commit.

---

## Phase 5: User Story 3 - Tags (P2)

**Goal:** add and remove tags on articles (read and saved), with suggestions; rename,
merge and delete; optional Add tags after capture.

- [ ] T023 [P] [US3] Write `e2e/tags.spec.ts`:
  - add a new tag, and an existing one through its suggestion, which takes 3 taps or
    fewer (SC-005);
  - "AI" and " ai " are the same tag;
  - remove a tag;
  - rename it, and see the new name everywhere;
  - rename into an existing name merges them;
  - delete it everywhere, with the articles kept;
  - the 21st tag is refused, with its message;
  - the capture screen's **Add tags**.
- [ ] T024 [US3] Implement:
  - `apps/pwa/src/screens/TagInput.svelte`: chips plus an input with a suggestions
    listbox;
  - `TagsSheet.svelte`: all tags with counts, Rename and Delete with Confirm;
  - wire them into `Article.svelte`, `Capture.svelte` (every mode) and `Library.svelte`
    ("All tags…");
  - tag id derivation and resolution in the worker (research R3), so every
    `TagArticle` gets its ids there;
  - `errors.ts`: messages for `TooManyTags`, `AlreadyRead` and `NotRead`.

  T023 must pass.

**Checkpoint:** review, run all checks, commit.

---

## Phase 6: User Story 4 - Search and filter (P2)

**Goal:** a Library search over titles, authors, sites, tags, highlights and notes, plus
an AND tag filter.

- [ ] T025 [P] [US4] Write `e2e/search.spec.ts`:
  - matches on a title word, a site, a tag, and a highlight phrase (the passage is shown
    with `<mark>`);
  - "cafe" finds "Café";
  - results show read and saved labels;
  - two selected chips filter with AND;
  - Clear resets;
  - "No results" offers Clear;
  - SC-004 in the UI: with 500 seeded articles, results appear within 200 ms of the last
    keystroke (best of 3). The 100 ms target at 5,000 is proved at the db level (T007).
- [ ] T026 [US4] Implement:
  - `apps/pwa/src/screens/ArticleSearch.svelte`: the searchbox (labelled "Search
    articles"), the 80 ms debounce, results with labels and `<mark>`, and the tag chips
    (`aria-pressed`, AND, plus "All tags…");
  - wire it into `Library.svelte` above the Articles and Saved lists;
  - the `search` query in the worker.

  T025 must pass.

**Checkpoint:** review, run all checks, commit.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T027 [P] Extend `e2e/screens.ts` and the a11y and layout specs: Saved, search with
  results, the tags sheet, and the article with tags, in both themes and at 320 px.
- [ ] T028 [P] Update the docs:
  - `README.md`: Save for later (⌥⇧S, menu), tags and search;
  - `docs/architecture.md`: schema v5, the tiers `t` and `s`, reconcile, the search
    index; the 009 export row must include `tags`, `item_tags` and saved state;
  - `CLAUDE.md`: a rule line for saved articles and tags.
- [ ] T029 Run the full validation (main session):
  - the full suite, plus `--repeat-each=2` on the new specs;
  - quickstart scenarios 1–17;
  - fill in the validation results;
  - bump the PWA to 0.9.0 and the extension to 0.7.0, and zip the extension;
  - list the manual device checks as pending.

---

## Dependencies & Execution Order

- **Phase 1** blocks everything.
  - T001–T005 run in parallel, then T006.
  - T007 and T009 are written in parallel, then T008, then T010.
- **Phase 2 (the MVP)**, then Phase 3, which needs Phase 2's Saved UI.
- **Phase 4** needs Phase 3 (Log-as-read semantics).
- **Phase 5** needs Phase 2, because it uses the Article and Capture screens. Phase 4's
  Add tags uses Phase 5's worker-side id derivation only on the PWA side, while the
  extension derives ids itself, so Phases 4 and 5 can run in either order. Their e2e
  runs take turns.
- **Phase 6** needs Phase 5 (the tag chips) and Phase 1's search index.
- **Phase 7** comes last.

## Implementation Strategy

1. **Foundation:** data, commands, the 0.8.0-safe sync, search. Tested with no UI.
2. **MVP:** save and Saved in the app and on the iPhone.
3. Reading saved articles, and reconcile.
4. The Mac extension.
5. Tags.
6. Search.
7. Polish and release 0.9.0, with extension 0.7.0. Merge when the user says.
