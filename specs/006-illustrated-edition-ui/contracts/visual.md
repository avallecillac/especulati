# Visual guide: screen by screen (006)

These are the design decisions for implementers. **Markup changes are additive**: keep
every existing element that the e2e specs locate (headings, buttons, links, labels,
`data-testid`s, `aria-label`s). Wrap, restyle or add decoration around them; don't
rename or remove them.

## Global type and page

- **Body:**
  - `font-family: var(--font-text)`, 18 px, `line-height: 1.45`;
  - `background: var(--paper) var(--texture)`, `color: var(--ink)`, `color-scheme:
    var(--scheme)`.
- **`h1`** (large title):
  - `var(--font-display)`, weight 600, 2.1 rem, line-height 1.1, letter-spacing −0.01 em;
  - margin 4 px 0 14 px.
- **`h2` (running head):**
  - `.smallcaps` (uppercase, 0.78 em, 0.12 em tracking), in `--ink-soft`;
  - centred between two hairlines (`::before` and `::after` flex rules), with margin
    28 px 0 10 px;
  - Home, Stats and Settings get the `Rule` fleuron separator between major groups.
- **Numbers in stats:**
  - `var(--font-display)` for big figures;
  - `font-variant-numeric: tabular-nums` in tables and the heatmap legend.
- **Links:** `--accent`, no underline, underlined on `:focus-visible`.
- **Focus rings:** 2 px `--accent` outline, offset 2 px (keep them visible).

## Shell

- **Top bar:**
  - height 44 px plus the top safe area;
  - background `--bar` with blur;
  - a hairline bottom border, shown only when compact;
  - left: the back link ("‹ Library", in the accent);
  - centre: the compact title, in the display face at 17 px weight 600, fading in when
    `data-compact`;
  - right: the sync button.
  - **On Home**, the centre always shows the wordmark *Readerlog* in the display face
    italic. Keep the existing brand link with its text "Readerlog".
- **Tab bar:**
  - background `--bar` with blur, a hairline top border;
  - each tab is a 26 px icon over a 11 px label (the text face, weight 500);
  - the current tab is in `--accent`, the others in `--ink-soft`.
- **Sheets:**
  - background `--leaf`, radius `--radius-sheet` on the top corners;
  - a grabber of 36 × 5 px in `--rule`, centred, 8 px from the top;
  - they enter with `translateY(100%) → 0`, 280 ms, `cubic-bezier(.2,.8,.2,1)`;
  - the backdrop is `--backdrop`.
- **Buttons:**
  - Primary: `--accent` background, `--on-accent` text, radius 12 px (iOS filled), the
    text face at weight 600.
  - Secondary: a `--leaf` background with a `--rule` hairline border.
  - `.link`: the accent colour.
  - Press: `scale(.97)` and opacity 0.85.
- **Grouped lists** (`ul.plain`, lists of settings):
  - background `--leaf`, radius `--radius-group`, horizontal margin 0 (the page
    gutter is 16 px);
  - separators are 0.5 px `--rule`, inset 16 px from the left;
  - rows are at least 44 px high with 11 px 16 px padding;
  - navigating rows end in a `›` chevron in `--rule`.
  - `.card` uses the same group look.

## Screens

- **Home: the current book is a chapter opening.**
  - Layout: a cover on the left, and on the right:
    - the status as a running head (small caps);
    - the title in `h1`;
    - the author in small caps, `--ink-soft`;
    - progress in italic.
  - **Drop cap:** a `DropCap` of the title's first letter sits *before* the card, as a
    decorative headpiece, with a `Sprig` under the card.
  - **No book:** the "No book in progress" group shows a `Butterfly` vignette, 48 px,
    above the text.
- **Library:** the list is a grouped list with covers of 40 × 60 px. Each row shows:
  - the title in the text face at weight 500;
  - the author in small caps;
  - the status on the right in italic.

  Empty state: a `Fish` vignette and "Your shelves are empty".
- **Articles:** a grouped list; the site in small caps, the reading time in italic.
  Empty state: a `Butterfly`.
- **Book detail:**
  - a centred title page: the cover at `md` size, the title as `h1` centred in the
    display face, and the author in small caps below;
  - then a `Rule`;
  - the history is a grouped list with dates in small caps.
- **Stats:**
  - the headline figure ("N reading days in YYYY") in the display face, large;
  - the heatmap uses `--heat-*` with a 2 px radius;
  - the tables are grouped lists with tabular figures;
  - the article stats sit under their own running head.
  - Empty state: a `Sprig` and "Log a page to begin your year".
- **Settings:** grouped lists.
  - **Appearance** comes first: three rows, each with a swatch of three overlapping 14 px
    circles, the name, and a check mark on the current one.
  - Then Sync (the button reads **Sync settings**), then the rest.
- **Log sheet:** the stepper number in the display face at 2 rem; "Today" /
  "Yesterday" as a segmented control.
- **Generated cover:**
  - a `--cloth-n` background, with an inset border 3 px from the edge in `--on-cloth`
    at 40% opacity;
  - a centred paper label (a `--leaf` rectangle, 70% wide) holding the initials in the
    display face, in `--ink`;
  - a tiny `Fleuron` in `--on-cloth` under the label (only at `md` size).
