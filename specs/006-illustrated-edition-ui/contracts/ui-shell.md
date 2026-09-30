# Contract: App shell and navigation

## Screen chrome

- Every routed screen renders exactly one `<h1>`: its large title.
- Scroll lock under sheets uses `html:has(.sheet-backdrop) { overflow: hidden }`, which
  covers every sheet and confirm with no JS.
- The top bar (`header.bar`) carries `data-title="<h1 text>"` and gets `data-compact`
  when the `<h1>` scrolls out of view. The compact title is CSS-generated content
  only.
- Top-level routes (`home`, `library`, `add`, `stats`, `settings`) have no back
  control. Every other route shows one from `nav.ts`:

| Route | Parent (label → target) |
|---|---|
| `book` | Library → `#/library` |
| `edit` | Book → `#/book/<id>` |
| `article` | Articles → `#/articles` |
| `scan`, `search`, `isbn` | Add → `#/add` |
| `sync` | Settings → `#/settings` |
| `duplicates` | Sync → `#/settings/sync` |
| `capture` | Library → `#/library` |
| `articles` | none: it is the Library tab's Articles view, depth 0 |

- The back control is a link, `<a class="back" href=…>‹ Parent</a>`, with the
  accessible name "Back to <Parent>". When the previous history entry is that
  parent, activating it calls `history.back()`, so scroll position is kept.

## Transitions

- `depth(route)`: top-level routes are 0; `book`, `article`, `scan`, `search`, `isbn`,
  `sync` and `capture` are 1; `edit` and `duplicates` are 2.
- Going to a greater depth pushes (the new screen slides in from the right). Going to a
  smaller depth pops. Equal depth doesn't animate.
- e2e: `contextOptions: { reducedMotion: 'reduce' }` is set in the config and in every
  custom context (relay and extension fixtures), so specs don't click through a transition.
- Only with `prefers-reduced-motion: no-preference` and `document.startViewTransition`
  available. Otherwise a 150 ms fade on `main`, or nothing.

## Tab bar

- The labels stay "Home", "Library", "Add", "Stats", "Settings", as links with those
  accessible names (the existing e2e depends on them). Icons are decorative
  (`aria-hidden`).

## Accessible names that must not change

Every button, link and heading name used by `e2e/*.spec.ts` stays the same. The one
exception is Settings → Sync card: "Sync" becomes "Sync settings" (FR-022), and the
specs that click it are updated in the same change.
