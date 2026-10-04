# Contract: Extension highlight capture (`apps/extension`)

## Manifest (version 0.6.0)

- **New command:** `"save-highlight": { "suggested_key": { "default": "Alt+Shift+H" },
  "description": "Save the selected text to Readerlog" }`.
- **Permissions:** no new ones. `activeTab`, `scripting` and `contextMenus` already
  exist.

## Context menu

- **New item:** `{ id: 'save-highlight', title: 'Save highlight to Readerlog', contexts:
  ['selection'] }`, next to the existing "Log as read".

## Sequence

1. **Trigger** (the menu or the command) on an `activeTab`. A non-`http(s)` URL behaves
   as 005 does.
2. **`executeScript(readSelection)`:** returns `getSelection().toString()`. It returns
   `''` when the selection is inside `input`, `textarea` or `[contenteditable]`.
   - An empty selection gives the toast "Select some text to highlight", and nothing is
     saved.
   - Over 5,000 characters gives "That passage is too long (5,000 characters max)".
3. **Article lookup:** `captured[normalizedUrl]` decides.
   - **A live entry:** use its `itemId`.
   - **Otherwise:** `executeScript(extractPage)`, then
     `capturePeer.capture({…, force: true})`. The article is logged, with no
     duplicate prompt.
4. **`capturePeer.highlight({ itemId, quote, at, localDate })`:** decides
   `AddHighlight` (id `uuidFromHash("readerlog-highlight-v1|"+url+"|"+at)`), then
   stamps it and appends it to `pending`.
5. **Toast:** "Highlight saved", with **Add note** and **Undo** (6 s, extended while the
   note box is open).
   - **Add note:** opens a textarea; Save gives `capturePeer.editNote(highlightId, note)`.
   - **Undo:** `capturePeer.undoHighlight(highlightId)`, plus `undo(itemId)` when step 3
     created the article.
6. **A push-only flush** follows (005).

## Capture peer additions (`packages/sync/src/capturePeer.ts`)

```ts
highlight(p: { itemId: string; quote: string; note?: string; at: string; localDate: string }):
  Promise<Result<{ highlightId: string }, 'notPaired' | 'invalid' | 'tooLong'>>;
editNote(highlightId: string, note: string): Promise<Result<void, 'invalid' | 'tooLong'>>;
undoHighlight(highlightId: string): Promise<void>;
```

- **Snapshot:** the peer builds a minimal snapshot for `decide`: the item `{ id, type:
  'article', deletedAt: null }` from `captured`, and the highlight from a new
  `highlights` map in storage (`{ [id]: { itemId, quote, note, at, removed? } }`, trimmed
  to the newest 2,000 **by `at`**, because `chrome.storage.local` doesn't keep key order).
- **After Add note:** a short "Note saved" toast replaces the highlight toast (Undo is
  no longer offered once a note has been saved).
- **Batches (R2):** `pending` is flushed so that no batch mixes `highlights` ops with
  other tables.
