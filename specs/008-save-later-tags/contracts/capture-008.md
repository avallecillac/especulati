# Contract: Saving from the Mac and the iPhone

## Capture link payload: extends 005 and 007

`{ v: 1, url, title?, author?, words?, at, quote?, note?, later?, tags? }`

| Key | Rule |
|---|---|
| `later: 1` | Save for later. Ignored when `quote` is present (a highlight wins) |
| `tags` | optional array of up to 20 names. Each name is normalised; invalid ones are dropped |

**The `/capture` screen, in save mode:**

1. **A live saved match:** "Already saved".
2. **A live read match:** the item is saved again as a new saved entry (re-reading is
   allowed), and the screen says "You read this on <date>".
3. **Otherwise:** `AddArticle` with no `readOn`. The id is derived as in 005, plus
   `|later`.
4. **The result:** "Saved for later" with the title · site, **Add tags** (with
   suggestions), **Undo** and **Done**.

**Log mode (005), changed:** when the URL has a live **saved** match, it runs
`MarkArticleRead` on it instead of `AddArticle`, and the screen shows "Logged" (FR-006).

**Highlight mode (007), changed:** a live saved match is marked read, then the highlight
is added.

## Shortcut "Save to Readerlog" (a new section in docs/ios-shortcut.md)

Duplicate "Log in Readerlog", then add the Dictionary key `later` (**Number**) = `1`.

## Mac extension 0.7.0

- **Menu item:** `{ id: 'save-later', title: 'Save for later', contexts: ['page', 'link'] }`.
- **Command:** `save-for-later`, Alt+Shift+S.
- **The page:**
  - extract (005);
  - `capturePeer.save(...)`, which uses `AddArticle` with no `readOn`;
  - record `captured[url] = { …, saved: true }`.
- **A link:** URL only. The title is the site, and there's no word count.
- **The toast:** "Saved for later" with **Add tags** (a comma-separated input) and
  **Undo**. Add tags stamps `TagArticle` ops, with ids derived in the service worker.
- **Log as read:** when `captured[url].saved` is set, it runs `MarkArticleRead`. The
  extension sends the full row it captured.
- **Batches:** the extension's batches follow `tierOf`, so saved and tag ops never share
  a batch with `base` ops.
