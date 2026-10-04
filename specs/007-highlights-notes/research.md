# Research: Highlights and Notes (007)

## R1. Storage: one synced table

- **Decision:** a new table, `highlights`, in migration 4. Each row is one highlight or
  one note. It is synced like `reading_events`: rows plus `field_clock` plus
  `change_log`, through `decide()` locally, and through `parseRemoteOp`'s allow-list
  remotely.
- **Columns:** `id`, `item_id` (references `items`), `quote` (nullable), `note`
  (nullable), `page` (nullable; books, later), `created_at`, `local_date`, `deleted_at`.
- **Checks:** `quote` and `note` are each at most 5,000 characters, and at least one is
  present.
- **Rationale:**
  - Separate rows mean two devices adding highlights at once both keep theirs (FR-011).
  - Per-field LWW handles concurrent edits to the same note.
  - The `page` column readies books (FR-013) with no further migration.
- **Alternatives considered:** a JSON array on the item. Concurrent appends would
  overwrite each other, which breaks FR-011.

## R2. Forward compatibility with devices that haven't updated (critical)

- **The problem:** a 0.7.0 device opens each pulled batch and rejects it as a whole if
  any op names an unknown table. The rejected batch is counted as `skipped`, and the
  cursor moves past it.
  - If a highlight travelled in the same batch as an article capture, the old device
    would lose the article for good.
  - After updating, it would never re-read that batch.
- **Decision, part 1: one table per batch, for highlights.** A pushed batch never mixes
  `highlights` ops with ops on other tables.
  - The DB push source and the extension's capture peer end a batch where the table
    "tier" changes. The tiers are `highlights` versus everything else.
  - `tierOf` lives in core, because db can't import sync.
  - An old device then skips only highlight batches.
- **Decision, part 2: re-read after updating.** Migration 4 resets `sync_cursor` to 0,
  so the next sync re-reads the whole space.
  - Ops already applied are recognised by `op_id` in `change_log` and ignored.
  - The skipped highlight batches are applied this time.
  - **Cost:** one full pull, once. At 10,000 ops that was 4.7 s in 004's SC-004.
- **What the user sees:** until a device updates, each skipped highlight batch adds to
  its sync status note, "N changes couldn't be read and were skipped". After the
  update, the re-read applies them, so migration 4 also resets that counter
  (`undecryptable`, inside the `sync_status` JSON in `meta`) to 0. The spec states this.
- **Tests:**
  - an old-schema peer (no `highlights` table) in the convergence harness keeps every
    article op while highlights flow, then converges after "upgrading";
  - a unit test that no pushed batch mixes tiers.

## R3. Normalising a quote (pure, core)

`normalizeQuote(text): Result<string | null, TooLong>`:

| Step | Detail |
|---|---|
| 1 | Convert CRLF and CR to LF |
| 2 | Collapse spaces and tabs (and NBSP) to a single space, per line, and trim each line |
| 3 | Collapse 3 or more newlines to 2 (keeps paragraph breaks) |
| 4 | Trim the whole quote; empty means `null` |
| 5 | More than 5,000 characters (code points) means `TooLong`. It is never truncated |

Notes go through the same rules, apart from step 2: a note keeps its spacing, but is
still trimmed and capped.

## R4. Jump back to the passage: text fragments, computed from the quote

- **Decision:** don't store an anchor. Build the link at display time from the stored
  URL and the quote, with `textFragment(quote)` in core:
  - **Quotes of up to 8 words:** `#:~:text=<quote>`.
  - **Longer quotes:** `#:~:text=<first 4 words>,<last 4 words>`.
  - **Encoding:** the words are percent-encoded, and `-`, `,` and `&` are escaped too.
    Line breaks become spaces.
- **Rationale:**
  - It stores nothing beyond the quote, which is the narrowest reading of the
    constitution amendment.
  - It works for hand-added quotes too.
  - Chrome and Safari (iOS 16.1 and later) scroll to and highlight the passage.
  - If the page changed, the browser just opens at the top (spec edge case).
- **Alternatives considered:**
  - Storing a prefix and suffix, which only helps with repeated passages. Not worth
    storing more text.
  - Chrome's link-to-highlight generator, which extensions can't call.

## R5. Mac capture: reading the selection

- **Trigger:** a context-menu item with `contexts: ['selection']`, plus the command
  `save-highlight` (suggested Alt+Shift+H). Both grant `activeTab`, as the existing
  capture does. No new permissions are needed.
- **Reading the selection:** `chrome.scripting.executeScript` runs a tiny function that
  returns `getSelection().toString()`.
  - The context menu's own `info.selectionText` loses line breaks, so it is used only
    as a fallback.
  - A selection inside an `input` or `textarea` returns nothing and is refused.
- **An article that isn't logged yet:** the existing `extractPage` runs in the same
  click, `capture()` logs it, and then the highlight is added. One Undo removes both
  (FR-003).
- **Toast:** the existing shadow-DOM toast gains a "Highlight saved" state with **Add
  note** and **Undo**.
  - **Add note** expands an inline textarea, saved with Enter or Save; Esc cancels.
  - The note goes to the service worker, which stamps an `EditHighlightNote` op.

## R6. iPhone capture: the same capture link, plus `quote`

- **Payload:** the capture payload (005 `contracts/capture.md`) gains optional keys,
  `quote` and `note`. When `quote` is present, `#/capture` runs in **highlight mode**:
  1. find or log the article, as today;
  2. then add the highlight, and show it with **Add note** and **Undo**.
- **Old app versions:** an old version ignores the unknown keys and just logs the
  article, which is a safe degradation.
- **Idempotence:** the highlight id is
  `uuidFromHash("readerlog-highlight-v1|" + url + "|" + at)`. Opening the link twice
  gives `AlreadyExists`, shown as "Already saved".
- **The Shortcut:** duplicate "Log in Readerlog" as "Highlight in Readerlog", add **Get
  Clipboard**, and add a `quote` key (Text, the **Clipboard** variable) to the
  Dictionary.
  - On first run, iOS may ask whether the Shortcut may paste. Choosing **Always Allow**
    keeps it at 3 taps (SC-002).
  - The guide gets a new section.

## R7. Undo and restore

- **Capture Undo:** `RemoveHighlight`, plus `RemoveArticle` when the same action created
  the article.
- **Undo after removing from the list:** `RestoreHighlight` (`deleted_at = null`).
  - It's a new command, because no restore exists yet.
  - Under LWW, the newer restore wins over the removal on every device.

## R8. Performance

- **Index:** `idx_highlights_item ON highlights(item_id, created_at) WHERE deleted_at IS
  NULL`.
- **Query:** `highlights(itemId)` reads one article's rows only. SC-006 sets 200 rows
  under 200 ms; a db perf test checks the query alone at under 20 ms.
