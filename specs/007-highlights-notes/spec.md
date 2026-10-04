# Feature Specification: Highlights and Notes for Articles

**Feature Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `007-highlights-notes`)

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "I'd like a new feature to add notes or highlights, initially
I need them in the articles. Select text from the article and be able to add it to
Readerlog."

Export/import, previously numbered 007, becomes **008**.

## Clarifications

### Session 2026-10-04

- Q: May highlighted text be stored, given the rule that article text is never stored?
  → A: Yes. Constitution v1.2.0 allows text the user explicitly selects, end-to-end
  encrypted and included in the export. Full article text is still never stored.
- Q: Highlighting an article that isn't logged yet? → A: Log it as read today, then
  attach the highlight.
- Q: Is the three-tap iPhone flow (select, Copy, Share → Highlight in Readerlog)
  acceptable? → A: Yes.
- Q: Scope? → A: Articles now. Books later, with a typed quote and a page number, so
  the model must allow it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save a highlight from the Mac (Priority: P1)

Reading an article in Chrome or Brave on the Mac, I select a passage and choose **Save
highlight to Readerlog**, from the right-click menu or with a keyboard shortcut. A small
note on the page confirms "Highlight saved", with **Add note** and **Undo**. The passage
appears under that article in Readerlog on all my devices.

**Why this priority**: most articles are read on the Mac. This is where highlights will
be made most.

**Independent Test**: with the extension paired, select a passage on a fixture article,
save it, sync another device, and check the passage is listed under the article.

**Acceptance Scenarios**:

1. **Given** a paired extension and a selected passage, **When** I choose **Save
   highlight to Readerlog** (menu or shortcut), **Then** a confirmation appears within
   1 second, and the highlight is saved with exactly the selected text.
2. **Given** an article not yet in my log, **When** I save a highlight from it, **Then**
   the article is also logged as read today. Its title, author and word count are
   collected as in a normal capture.
3. **Given** the article is already logged, **When** I save a highlight, **Then** no
   second article entry is created. The highlight joins the existing one.
4. **Given** the confirmation, **When** I tap **Add note** and type a note, **Then** the
   note is saved with that highlight.
5. **Given** the confirmation, **When** I tap **Undo** within 6 seconds, **Then** the
   highlight is removed. If the article was logged by this same action, it is removed
   too.
6. **Given** no text is selected, **When** I use the shortcut, **Then** nothing is saved,
   and the page says "Select some text to highlight".
7. **Given** I'm offline, **When** I save a highlight, **Then** it is kept and sent when
   I'm back online, as article captures are.

---

### User Story 2 - Save a highlight from the iPhone (Priority: P1)

In Chrome or Safari on the iPhone, I select a passage, tap **Copy**, then **Share →
Highlight in Readerlog**. Readerlog opens and confirms the highlight, with **Add note**
and **Undo**.

**Why this priority**: the user reads on the iPhone too, and the same habit has to work
there.

**Independent Test**: open a highlight capture link carrying an address and a passage,
and check the highlight is saved under the right article, logging the article first if
needed.

**Acceptance Scenarios**:

1. **Given** a valid highlight link, **When** Readerlog opens it, **Then** the highlight
   is saved under the article with that address, and a confirmation shows the quote.
2. **Given** the article isn't logged, **When** the link opens, **Then** the article is
   logged as read today (title from the link if given, otherwise the site), and the
   highlight is attached.
3. **Given** the same link is opened twice, **Then** the highlight is saved once, and
   the second time shows "Already saved".
4. **Given** the clipboard was empty, or the link is damaged, **Then** nothing is saved,
   and the screen says which part is missing.
5. **Given** the confirmation, **When** I tap **Add note**, **Then** I can type a note
   for that highlight.

---

### User Story 3 - See, open and manage highlights (Priority: P1)

On an article's screen, a **Highlights** section lists its saved passages, oldest first.
Each one shows:
- the quote, set like a passage quoted in a fine edition;
- my note beneath it, if there is one;
- the date it was saved.

Tapping a quote opens the article at that passage. I can edit a note, or remove a
highlight with Undo.

**Why this priority**: highlights are worthless if I can't find them again.

**Independent Test**: seed two highlights, one with a note. Open the article, edit a
note, remove a highlight, undo the removal, and check the link targets the passage.

**Acceptance Scenarios**:

1. **Given** an article with highlights, **When** I open it, **Then** I see each quote,
   its note and its date, oldest first.
2. **Given** a highlight, **When** I tap its quote, **Then** the article opens in the
   browser, scrolled to that passage where the browser supports it, or at the top
   otherwise.
3. **Given** a highlight, **When** I edit its note and save, **Then** the new note shows
   at once and syncs.
4. **Given** a highlight, **When** I remove it, **Then** it disappears, and **Undo**
   brings it back. Removal syncs like any other removal.
5. **Given** an article with no highlights, **Then** the section invites me to add one.

---

### User Story 4 - Add a highlight or note by hand (Priority: P2)

On any article's screen, I can **Add highlight** (paste or type a quote, with an
optional note) or **Add note** (just my own thought). This also works for articles
logged before this feature existed.

**Why this priority**: it's the fallback when capture isn't possible, and the way to
add thoughts later.

**Independent Test**: on a logged article, add a pasted quote with a note, and a note
on its own. Check both are listed and synced.

**Acceptance Scenarios**:

1. **Given** an article, **When** I add a quote with a note, **Then** it is listed like
   a captured highlight. It has no jump-to-passage link unless the quote can be located
   by text.
2. **Given** an article, **When** I add a note without a quote, **Then** it is listed as
   a note, in the note style and without a quote.
3. **Given** an empty quote and an empty note, **Then** saving is refused.

### Edge Cases

- **Very long selections.** A quote is capped at 5,000 characters, and a note at 5,000.
  On capture, a longer selection is refused with "That passage is too long (5,000
  characters max)". It is never silently cut.
- **Whitespace and formatting.** Line breaks between paragraphs are kept. Runs of
  spaces collapse, and the quote is trimmed. Formatting (bold, links) is not kept.
- **The same passage highlighted twice.** It is saved twice only when saved at
  different times (two deliberate actions). Opening the same capture link twice saves
  it once.
- **An article removed later.** Its highlights are hidden with it, and restored if it is
  restored. They are never deleted.
- **A highlight added on two devices at once.** Both are kept: highlights are separate
  entries, not fields that overwrite each other.
- **The page changed since the highlight.** The jump link may no longer find the
  passage. The browser then opens the article at the top, and the quote is still shown
  in Readerlog.
- **Selection inside a form field, or on a non-http(s) page.** It is refused with the
  extension's existing "Can't log this page" behaviour.

## Requirements *(mandatory)*

### Functional Requirements

**Capture**

- **FR-001**: The Mac extension MUST offer **Save highlight to Readerlog** in the
  right-click menu when text is selected, and as a keyboard command (suggested Alt+Shift+H,
  changeable in the browser).
- **FR-002**: A capture MUST store exactly the user's selection, normalised as in the
  edge cases. It MAY also store a short anchor (at most the few words before and after
  the selection) to find the passage again. It MUST NOT store any other page text
  (constitution II).
- **FR-003**: Saving a highlight on an article that isn't logged MUST log the article as
  read today, collecting its details as a normal capture does, in the same action and
  with one Undo.
- **FR-004**: The confirmation MUST offer **Add note** and **Undo** (6 seconds). A note
  added there MUST be saved with the highlight.
- **FR-005**: An iPhone Shortcut, "Highlight in Readerlog", MUST open a highlight capture
  link carrying the page address, the copied passage and the capture time. It MAY also
  carry the title. Readerlog MUST save it, and opening the same link twice MUST save it
  only once.
- **FR-006**: Captures MUST work offline and be sent later, as article captures do.

**Viewing and managing**

- **FR-007**: The article screen MUST show a Highlights section, oldest first. Each entry
  shows the quote (if any), the note (if any) and the saved date.
- **FR-008**: Tapping a quote MUST open the article at that passage where the browser
  supports text links, and at the article otherwise.
- **FR-009**: Users MUST be able to edit a note, and to remove a highlight or note with
  Undo. Removal is a tombstone.
- **FR-010**: Users MUST be able to add a highlight (quote with an optional note) or a
  note (text only) by hand on any article.

**Data**

- **FR-011**: Highlights and notes MUST sync between devices end-to-end encrypted. Two
  devices adding entries at the same time MUST keep both. Edits to the same note follow
  the existing last-writer-wins rule.
- **FR-012**: Highlights MUST be included in the export (feature 008).
- **FR-013**: The model MUST allow a highlight to belong to a book later, with a page
  number instead of a link, without a further data migration.
- **FR-014**: Highlights MUST NOT change any book or article statistic.

### Key Entities

- **Highlight**: belongs to one item (an article now, a book later). It has:
  - an optional quote (up to 5,000 characters);
  - an optional note (up to 5,000 characters), with at least one of the two present;
  - an optional anchor to find the quote in the page;
  - an optional page (books, later);
  - when it was saved, and its local date;
  - a removed flag (tombstone).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the Mac, saving a highlight takes 1 action after selecting (menu item
  or shortcut). The confirmation appears within 1 second, without waiting for the
  network.
- **SC-002**: On the iPhone, saving a highlight takes 3 taps after selecting (Copy,
  Share, the Shortcut).
- **SC-003**: A highlight saved on one device is visible on another after its next
  sync, in 100% of test runs. The relay never sees the quote or the note in readable
  form.
- **SC-004**: In 20 fixture pages, the saved quote equals the selected text, after
  normalisation, in 20 out of 20. No other page text is stored.
- **SC-005**: Tapping a quote opens the article scrolled to the passage, in supporting
  browsers, for at least 18 of the 20 fixture pages.
- **SC-006**: Opening an article with 200 highlights shows the list within 200 ms.

## Assumptions

- **Fixed caps:** 5,000 characters each for a quote and a note, as a sensible upper
  bound for a passage.
- **Clipboard on the iPhone:** the Shortcut reads the clipboard with Shortcuts' own
  action, so iOS shows no paste prompt. If iOS ever does prompt, it's one extra tap.
- **Jump-to-passage** uses the web's standard text links. Chrome supports them, and so
  does Safari from iOS 16.1 and macOS 13.
- **Out of scope:**
  - re-drawing highlights on the web page;
  - books (the model is ready for them);
  - a cross-article "commonplace book" view;
  - search;
  - colours or tags for highlights;
  - a ready-made, shared iPhone Shortcut (parked).
- **The Mac extension gains a context-menu item and a command.** It requests no new
  site permissions: the selection is read through the existing on-click access.
