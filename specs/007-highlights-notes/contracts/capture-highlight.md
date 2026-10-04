# Contract: Highlight capture link and Shortcut

## Payload: an extension of 005 `contracts/capture.md`

```
https://<app>/#/capture?d=<URL-encoded Base64 of { v: 1, url, title?, author?, words?, at, quote?, note? }>
```

- **`quote`** (new, optional): the passage. Normalised per research R3. Over 5,000
  characters, the screen shows "That passage is too long", and **nothing** is saved
  (neither the article nor the highlight).
- **`note`** (new, optional): only used with `quote`.
- **No `quote`, or an empty one:** the link behaves exactly as an article capture (005).
- **The `/capture` screen in highlight mode:**
  1. It parses the payload. A damaged link names its field (`quote` too).
  2. **Article lookup:** `findArticleByUrl`, and if missing, `AddArticle` as today (the
     same derived id, research 005 R5).
     - A **removed** match is logged again, as a new article.
     - A **live** match is used. There is no "Already logged" prompt in highlight mode,
       because highlighting a logged article is normal.
  3. It runs `AddHighlight` with id `uuidFromHash("readerlog-highlight-v1|"+url+"|"+at)`.
     `AlreadyExists` shows "Already saved".
  4. It shows the quote, in the edition style, with **Add note**, **Undo** (6 s) and
     **Done**.
     - **Undo:** `RemoveHighlight`, plus `RemoveArticle` if step 2 created the article.
  5. **Sync:** if sync is on, `sync('manual')` runs; otherwise the "Finish setup" prompt
     shows, as today.

## Shortcut "Highlight in Readerlog" (`docs/ios-shortcut.md`, new section)

Duplicate "Log in Readerlog", then:

1. Add **Get Clipboard** after *Get Article*.
2. In the **Dictionary**, add `quote` (**Text**), with the **Clipboard** variable.
3. Name it **Highlight in Readerlog**. It appears in the Share Sheet for **URLs**.

**Use:** select text, **Copy**, then **Share → Highlight in Readerlog**. On the first run,
choose **Always Allow** when iOS asks about pasting.
