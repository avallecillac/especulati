# Contract: PWA highlights UI and worker API

## Worker API (`apps/pwa/src/lib/protocol.ts`)

- **New query:** `{ name: 'highlights'; itemId: string }` returns `Highlight[]`.
- **Commands:** `AddHighlight`, `EditHighlightNote`, `RemoveHighlight` and
  `RestoreHighlight` go through the existing `dispatch`, with ids from
  `crypto.randomUUID()`. Capture uses the derived id instead.
- **Change notifications:** the existing ones fire on these writes, so open screens
  refresh.

## Article screen (`Article.svelte`)

- **Section heading:** a running head, "Highlights".
- **Each entry** is an `<article>`, with the label "Highlight" or "Note":
  - **Quote** (if any): a `<blockquote>` in the text face, italic, with a 2 px ochre
    (`--ornament`) left rule.
    - It is a link to `passageUrl(url, quote)`, opening in a new tab, with
      `rel="noopener noreferrer"`.
    - Long quotes show 8 lines with **Show all** (the line clamp is CSS).
  - **Note** (if any): roman text face, `--ink`.
  - **Date:** the saved date in small caps, `--ink-soft`.
  - **Actions:** a "More" button opens a sheet with **Edit note** (or **Add note**) and
    **Remove**.
    - **Remove** shows the toast "Highlight removed · Undo", which restores it.
- **Order:** oldest first.
- **Buttons** under the list: **Add highlight** (a sheet with a Quote textarea and a
  Note textarea) and **Add note** (a sheet with a Note textarea).
  - Character counters appear past 4,500 characters.
  - Save is disabled while both are empty.
- **Empty state:** a small Fleuron, and "Select a passage while reading to keep it
  here."
- **Tokens only:** no literal colours (the 006 guard test). Decorative SVG is
  `aria-hidden`.

## Capture screen (`Capture.svelte`), highlight mode

- **Shows:** "Highlight saved", the quote in the same blockquote style, and the article
  title · site.
- **Buttons:** **Add note** (an inline textarea, then Save), **Undo** and **Done**.
- **Errors:** "This capture link is damaged" with its field (as today); "That passage is
  too long".

## Accessible names (for e2e)

| Element | Name |
|---|---|
| the section | the heading "Highlights" |
| buttons | "Add highlight", "Add note", "Edit note", "Remove", "Show all" |
| sheet fields | labels "Quote" and "Note" |
| each entry | `role="article"` labelled "Highlight" or "Note" |
| the quote link | its quote text |
