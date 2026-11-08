# Research: Save for Later, Tags and Search (008)

## R1. A saved article is an article with no read date

- **Decision:** a saved article is an `items` row with `type = 'article'` and `read_on IS
  NULL`. Its saved date is its `created_at`. No new column is needed.
  - `read_on` has been nullable since migration 1.
  - Every existing article has a read date.
- **Marking as read** sets `read_on` (see R2 for what the op carries).
- **Undo** sets it back to `NULL`.
- **Read models change:**
  - every query and stat that means "read articles" adds `read_on IS NOT NULL`
    (`articles()`, `loadArticles`, `findArticleByUrl` for the "Already logged" prompt);
  - a new `savedArticles()` lists the saved ones.
- **Rationale:** a saved and a read article are the same thing at different moments.
  Highlights (007) and tags then attach to one id across both states.
- **Alternatives considered:** a separate `saved_articles` table. Marking as read would
  then have to copy the row, plus its tags and highlights, into `items`.

## R2. Devices on 0.8.0 must never receive a saved article (critical)

- **The problem:** 0.8.0 reads every live article's `read_on` with `text()`, which
  throws on `NULL` (`queries.ts:239, 269`; `stats.ts:58`). One saved article reaching a
  0.8.0 device would break its Articles list and Stats screen.
- **Decision: more batch tiers.** `tierOf(tbl, fields)` in core:

  | Op | Tier |
  |---|---|
  | `highlights` | `h` (007) |
  | `tags`, `item_tags` | `t` |
  | an `items` op whose fields set `read_on: null` | `s` |
  | everything else | `base` |

  A pushed batch never mixes tiers (007 contracts/sync-tiers.md). A 0.8.0 device skips
  `t` and `s` batches whole, as 0.7.0 skipped `h`.
- **Marking as read carries the whole row.** `MarkArticleRead` emits every insert field
  of the article (`type`, `title`, `url`, `domain`, `author`, `word_count`,
  `metadata_status`, `created_at`, `read_on`) as one `base` op.
  - A 0.8.0 device that never saw the saved row receives a **complete read article**,
    and shows it correctly.
  - A device on the new version applies it as an ordinary update (LWW per field).
- **Edits to a saved article** before it's read (title, tags) can reach a 0.8.0 device
  that has no row for it. Those ops are parked in `sync_inbox`, which is harmless; the
  old device's status may mention changes "waiting".
  - When `MarkArticleRead` arrives later, the row is created and the parked ops apply.
  - Updating re-reads anyway.
- **Migration 5** resets `sync_cursor` and `undecryptable`, as migration 4 did, so
  updated devices re-read what they skipped.
- **Tests:**
  - an "0.8.0 peer" in the convergence harness, which rejects `t` and `s` batches and
    parks unknown rows;
  - assert it never holds an article with `read_on NULL`, never throws, keeps every
    `base` op, and converges after upgrading.

## R3. Tags: ids derived from the name, so devices converge

- **Tables:** migration 5 recreates the unused v1 tables (verified empty: nothing writes
  them).
  - `tags(id, name, name_key, created_at, deleted_at)`
  - `item_tags(id, item_id, tag_id, created_at, deleted_at)`
- **Normalising a name:** `name_key = nfkc(name).trim().replace(/\s+/g,' ').toLowerCase()`.
  The shown name is the trimmed one, at 1 to 40 characters.
- **Ids are computed in the shell** (the worker, which has WebCrypto), never in core:
  - tag: `uuidFromHash("readerlog-tag-v1|" + name_key)`;
  - assignment: `uuidFromHash("readerlog-item-tag-v1|" + item_id + "|" + tag_id)`.
- **Why derived ids:** two devices creating "ai" offline produce the same tag id, so they
  converge with no merge step. Adding, removing and re-adding a tag on an article
  toggles one row's `deleted_at` (LWW).
- **Collisions after a rename:** a renamed tag keeps its id, so its old key's id is
  "taken". Creating that old name again resolves in this order:
  1. a live tag with the same `name_key` → use it;
  2. the derived id is free → use it;
  3. the derived id is a tombstone → restore it with the new name;
  4. otherwise → use `uuidFromHash("readerlog-tag-v1|" + name_key + "|" + n)` for the
     first free n.

  Lists group live tags by `name_key`, so a rare concurrent duplicate still shows as
  one tag.
- **Rename and merge:**
  - `RenameTag(tagId, newName)` sets `name` and `name_key`.
  - If another live tag already has the new key, the rename becomes a **merge**:
    1. every live assignment of the source moves to the target (the target's derived
       assignment ids are inserted or restored, and the source's are tombstoned);
    2. the source tag is tombstoned.
- **Delete:** `DeleteTag` tombstones the tag and all its live assignments.
- **Limits:** at most 20 live tags per article, enforced in `decide` (`TooManyTags`).
  Tags apply to articles only (the spec clarification).

## R4. Logging a URL that was saved elsewhere: automatic article merge

- **Same device:** the PWA, the capture link and Add article find the saved article
  first (`findSavedByUrl`) and run `MarkArticleRead` on it, with no new row.
- **On the Mac, a URL the extension saved itself:** its `captured` map records
  `{ saved: true }`, so it marks that entry read.
- **On the Mac, a URL saved on another device:** the push-only extension can't know about
  it. It logs a new article. The duplicate is resolved where the data meets, by
  `ReconcileSavedArticle`:
  - **When it runs:** any device running the PWA, after applying a pulled page or a
    local write.
  - **What it detects:** a live **saved** article and a live **read** article with the
    same normalised URL, where the read one was created later.
  - **Survivor:** the saved one, which is older. It gets the read one's `read_on`.
  - **Copies:**
    - the read one's highlights are copied, with content-addressed ids (as 004's
      `MergeBooks` does);
    - its tags are added through the derived assignment ids, which makes them
      idempotent.
  - **The read one** gets `deleted_at` plus `merged_into = survivor` (004 column).
  - **Two saved copies** of one URL (saved on two devices) merge the same way into the
    earliest.
  - **Determinism:** every id is derived, so devices doing this concurrently produce
    identical changes. The convergence test covers it.
- **Alternative considered:** a prompt, as for duplicate books. Rejected: a saved-then-
  read pair is never two different articles, so asking adds friction for nothing.

## R5. Search: an in-memory index in the worker

- **Index:** on first search, the worker loads one row per live article. The row holds
  the title, author, domain, tag names, highlight quotes and notes, normalised as
  NFD → strip combining marks → lower-case.
- **Query:** split into terms. An article matches when every term is a substring of one
  of its fields. Tag filter chips must all match.
- **Result:** the article, plus the first matching highlight or note, if the match came
  from one.
- **Invalidation:** on every change notification, the index is dropped, then rebuilt
  lazily.
- **Budget:** under 100 ms per keystroke at 5,000 articles and 2,000 highlights, measured
  in the db perf test. 005 R10b loaded 5,000 articles in about 25 ms using
  `selectArrays`.
- **Debounce:** 80 ms in the UI. Old results stay on screen until the new ones are ready.
- **Alternative considered:** SQLite FTS5. It isn't in the default WASM build options we
  ship, it has no accent folding without the ICU or unicode61 tokenizer setup, and it
  would need another synced-schema concern. The substring index is enough at this
  scale.

## R6. Capture

- **Mac extension (0.7.0):**
  - **Context menu:** "Save for later" for `contexts: ['page', 'link']`. On a link, the
    page isn't loaded, so only the URL is saved: the site as title and
    `metadata_status = 'failed'`, as Add article by URL does.
  - **Command:** `save-for-later`, Alt+Shift+S. That makes 3 suggested keys; Chrome
    allows 4.
  - **Toast:** "Saved for later", with **Add tags** and **Undo**.
  - **Add tags** opens a small input with comma-separated tags. It stamps
    `TagArticle` ops, with tag ids derived in the service worker through `uuidFromHash`.
    The extension can't see the tag list, so there are no suggestions.
- **The capture link (iPhone):**
  - The payload gains `later: 1` and an optional `tags: string[]`.
  - The "Save to Readerlog" Shortcut is "Log in Readerlog" with one Dictionary key,
    `later` = 1.
  - A link with both `later` and `quote` is treated as a highlight; `later` is ignored.
- **The capture screen** gains **Add tags** (with suggestions, because the PWA has the
  list).
- **Old app versions:** an old PWA opening a `later` link ignores the key and logs the
  article as read, which is acceptable. The guide says to update first.
