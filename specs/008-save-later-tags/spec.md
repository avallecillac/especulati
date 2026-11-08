# Feature Specification: Save for Later, Tags and Search

**Feature Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `008-save-later-tags`)

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description: "Let's add a feature for 'save for later' web articles and
the ability to tag articles so I can search them easier."

Export/import, previously numbered 008, becomes **009**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save an article for later (Priority: P1)

I come across an article I don't have time for. On the Mac I right-click → **Save for
later** (or press a shortcut). On the iPhone I share it to **Save to Readerlog**. In the
app I can add a URL with **Read later**. It goes into a **Saved** list, not into my read
articles, and it doesn't count in my stats.

**Why this priority**: it's the core of the request. Without it, every article I keep
is wrongly counted as read.

**Independent Test**: save an article from each path, check it appears in Saved, newest
first, and that article stats don't change.

**Acceptance Scenarios**:

1. **Given** a paired extension, **When** I choose **Save for later** on an article,
   **Then** a note on the page confirms "Saved for later". The article, with its title,
   site and reading time, appears in Saved on my devices after sync.
2. **Given** the iPhone Shortcut, **When** I share an article to **Save to Readerlog**,
   **Then** Readerlog confirms "Saved for later", with **Undo**.
3. **Given** the Articles screen, **When** I add a URL and choose **Read later**, **Then**
   it is saved, not logged.
4. **Given** saved articles, **Then** the Saved list shows them newest first, with title,
   site, reading time and the date saved, and the Library shows how many there are.
5. **Given** a saved article, **Then** it is not counted in "this week", "this month",
   reading time or top sites until it is read.
6. **Given** a URL that's already saved, **When** I save it again, **Then** no duplicate
   is created, and the confirmation says "Already saved".
7. **Given** a URL I already read, **When** I save it for later, **Then** a new saved
   entry is created (re-reading is allowed), and the confirmation says "You read this
   on <date>".

---

### User Story 2 - Read what I saved (Priority: P1)

I open a saved article from the Saved list, read it, and mark it as read. It then moves
to my read articles, dated today, and counts in my stats. If I log it from the Mac or
the iPhone instead, Readerlog notices it was saved and marks it read rather than adding
a second copy.

**Why this priority**: saving is only useful if reading it closes the loop cleanly.

**Independent Test**: save an article, then (a) Mark as read in the app, and (b) save
another one and log it with the extension. In both cases there's exactly one article,
read today, and the Saved list is empty.

**Acceptance Scenarios**:

1. **Given** a saved article, **When** I tap it, **Then** the page opens in the browser.
2. **Given** a saved article, **When** I choose **Mark as read**, **Then** it moves to
   the read Articles list, dated today, and the stats include it. **Undo** puts it back
   in Saved.
3. **Given** a saved article, **When** I log the same page as read from the extension
   or the iPhone, **Then** that saved entry becomes read today. No second article is
   created, and there's no "Already logged" prompt.
4. **Given** a saved article I no longer want, **When** I remove it, **Then** it leaves
   the Saved list (with Undo), and no stats are affected.
5. **Given** a saved article, **When** I save a highlight on it (007), **Then** it is
   marked as read today, as 007 does for an article that isn't logged.

---

### User Story 3 - Tag articles (Priority: P2)

I add tags such as "ai", "design" or "longform" to articles, read or saved. New tags are
created as I type, and existing ones are suggested. I can add tags on the article's
screen at any time, and optionally right after capturing. I can rename a tag or delete
it everywhere.

**Why this priority**: tags make a growing log findable. It's the user's second ask.

**Independent Test**: add two tags to an article, one new and one suggested. Rename one
tag and check every article shows the new name. Delete a tag and check it's gone from
all articles.

**Acceptance Scenarios**:

1. **Given** an article, **When** I type a tag name and confirm, **Then** the tag is
   added, created if it's new, and shown on the article.
2. **Given** existing tags, **When** I start typing, **Then** matching tags are suggested,
   most used first.
3. **Given** tags that differ only in letter case or surrounding spaces ("AI", " ai "),
   **Then** they are the same tag.
4. **Given** a capture confirmation (extension or iPhone), **When** I choose **Add
   tags**, **Then** I can tag the article there. It's optional and never required.
5. **Given** a tag, **When** I rename it, **Then** every article shows the new name.
   Renaming to an existing tag's name merges the two.
6. **Given** a tag, **When** I delete it, **Then** it is removed from every article. The
   articles themselves stay.

---

### User Story 4 - Search and filter (Priority: P2)

In the Library, a search field finds articles (read and saved) by title, author, site
or tag as I type, and I can filter by one or more tags.

**Why this priority**: it's the payoff of tagging, and the user's stated goal ("so I can
search them easier").

**Independent Test**: with 50 tagged articles, search a word in a title, a site and a
tag, then filter by two tags, and check the results each time.

**Acceptance Scenarios**:

1. **Given** the Library, **When** I type in the search field, **Then** results update
   as I type. They match words in the title, author, site or tag names, ignore case and
   accents ("cafe" finds "Café"), and show read and saved articles, each marked as such.
2. **Given** tag chips, **When** I select one or more, **Then** only articles having
   **all** the selected tags are shown. Combined with the search text, both must match.
3. **Given** no results, **Then** the screen says so and offers to clear the search.
4. **Given** search text, **Then** searching also covers [NEEDS CLARIFICATION: should
   search include the text of highlights and notes (007), or only titles, authors,
   sites and tags?].

### Edge Cases

- **Saving a page with no readable article** (a product page, for example). It is saved
  with the site as its title and no reading time, as capture does today.
- **Saving offline.** It is kept and synced later, on every path.
- **The same URL saved on two devices before syncing.** Both copies are kept. The
  Saved list shows the earlier one, plus the duplicates prompt that already exists
  for articles, if any.
- **Marking as read on two devices at once.** The article ends up read, dated with the
  later of the two dates (last writer wins).
- **A deleted tag being added on another device at the same time.** The tag is deleted
  everywhere, and an add made before the delete synced is undone with it.
- **Very many tags.** Tag names are at most 40 characters, and an article has at most 20
  tags.
- **Removing an article.** Its tags are kept on the tag (the count drops), and its
  highlights are hidden (007).
- **Devices that haven't updated.** They don't see saved articles or tags until they
  update. They must not lose any other data, and must catch up after updating (as in
  007).

## Requirements *(mandatory)*

### Functional Requirements

**Save for later**

- **FR-001**: The Mac extension MUST offer **Save for later** in its right-click menu
  (on the page and on links) and as a keyboard command. The toolbar click stays **Log
  as read**.
- **FR-002**: The iPhone MUST support a **Save to Readerlog** Shortcut, using the
  capture link with a "save for later" marker.
- **FR-003**: The Articles screen's Add article MUST offer **Read later**.
- **FR-004**: A saved article MUST have no read date, and MUST NOT count in any
  statistic until it is read.
- **FR-005**: The Library MUST show a **Saved** list, newest first, with a count. Each
  entry opens the page, and offers **Mark as read** and **Remove**, each with Undo.
- **FR-006**: Logging a URL that's in Saved MUST mark that entry as read today, instead
  of creating a new article or asking about a duplicate. This applies to the extension,
  the iPhone link, Add article, and highlighting (007).
- **FR-007**: Saving a URL that's already saved MUST NOT create a duplicate.

**Tags**

- **FR-008**: Users MUST be able to add and remove tags on an article from its screen,
  with suggestions from existing tags, and create new tags inline. The scope is
  [NEEDS CLARIFICATION: articles only, or books too?].
- **FR-009**: Tag names MUST be matched case-insensitively and with surrounding spaces
  trimmed. They are at most 40 characters, and an article has at most 20 tags.
- **FR-010**: Users MUST be able to rename a tag, merging it if the name exists, and to
  delete a tag everywhere. Both are reachable from a tag list in the Library.
- **FR-011**: The capture confirmations on the Mac and the iPhone MUST offer an optional
  **Add tags** step. It is never required, so the capture tap count is unchanged.

**Search**

- **FR-012**: The Library MUST offer a search over titles, authors, sites and tag names,
  matching as the user types, ignoring case and accents, across read and saved
  articles.
- **FR-013**: The Library MUST offer tag filtering (all selected tags must match),
  combinable with the search text.

**Data**

- **FR-014**: Saved state, tags and tag assignments MUST sync end-to-end encrypted, and
  MUST be included in the export (009).
- **FR-015**: Devices that haven't updated MUST NOT lose any data while others use these
  features, and MUST catch up after updating.

### Key Entities

- **Article** (existing): gains a "saved" state. A saved article is one with no read date
  yet, plus the date it was saved.
- **Tag**: a name (unique ignoring case), plus whether it was deleted.
- **Tag assignment**: links one tag to one item, and can be removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Saving for later takes 1 action on the Mac and 2 taps on the iPhone, the
  same as logging today. The confirmation appears within 1 second.
- **SC-002**: A saved article later logged on any path results in exactly one article,
  read, in 100% of tests.
- **SC-003**: Saved articles change no statistic, as checked deep-equal with and
  without 100 saved articles.
- **SC-004**: With 5,000 articles and 100 tags, search results update within 100 ms of
  each keystroke.
- **SC-005**: Adding a tag takes at most 3 taps when the tag exists (open the field,
  pick the suggestion, done).
- **SC-006**: A device that hasn't updated keeps 100% of its non-tag, non-saved data
  while others use these features, and converges after updating (convergence test).

## Assumptions

- **"Mark as read"** dates the article today. The read date can be edited afterwards, as
  it can today.
- **Saving reuses the article capture path.** On the Mac the same page details are
  collected (title, author, word count). The iPhone Shortcut is a duplicate of "Log in
  Readerlog" with one extra key.
- **Search is local**, over the device's own data. Nothing is sent anywhere.
- **Book stats are unaffected.** Saved articles never appear in book screens.
- **Out of scope:**
  - reminders for saved articles;
  - "read later" for books (that's the existing *queued* state);
  - smart or nested tags;
  - colour-coded tags;
  - full-text search of article bodies, which are never stored (constitution II).
