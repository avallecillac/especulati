# Feature Specification: ISBN Scan & Book Metadata Lookup

**Feature Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `002-isbn-scan-metadata`)

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "barcode scan and book metadata lookup"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scan a book's barcode to add it (Priority: P1)

I point my phone's camera at the barcode on the back of a book. Readerlog reads the
ISBN, looks the book up, and shows a confirmation screen already filled in with the
title, author, page count, genre, and cover. I check it, fix anything that's wrong,
and save. **Start reading now** is on by default, so the book becomes my current book.

**Why this priority**: typing titles and page counts is the biggest source of friction
when adding books. Scanning makes adding a book take seconds, and it gives an accurate
page count, which progress and pace depend on.

**Independent Test**: with the network available, scan (or feed the scanner) the
barcode of a well-known book. The confirmation screen shows its correct title, author,
and page count. After saving, the book is the current book on Home, with its cover.

**Acceptance Scenarios**:

1. **Given** the Add screen, **When** I choose **Scan barcode**, **Then** the camera
   view opens and asks for camera permission if it hasn't been granted yet.
2. **Given** the camera view, **When** a valid book barcode is in frame, **Then** it is
   recognized without pressing any button. The device gives a short confirmation, and
   the camera closes.
3. **Given** a recognized ISBN that the catalogs know, **When** the lookup finishes,
   **Then** a confirmation screen shows the title, author(s), total pages, a suggested
   genre, and a cover image. Every field is editable.
4. **Given** the confirmation screen, **When** I save, **Then** the book is stored with
   its ISBN and the details I confirmed. With **Start reading now** on, it is the
   current book.
5. **Given** a saved scanned book, **When** I later open the app offline, **Then** its
   cover is still shown.

---

### User Story 2 - Add a book when the lookup can't help (Priority: P1)

Sometimes the network is down, the catalogs don't know the book, or the lookup is
slow. I can still add the book right away, so I never lose the moment. Readerlog saves
what it has and fills in the missing details later when it can.

**Why this priority**: Constitution I (local-first). A network problem must never
block recording reading.

**Independent Test**: go offline, scan a barcode, and save. The book appears as
"ISBN 978…" with **Details pending**. Go back online and open the app. The details
fill in without any action from me, and nothing I typed myself is overwritten.

**Acceptance Scenarios**:

1. **Given** no network, **When** a barcode is scanned, **Then** the confirmation
   screen opens immediately, with the ISBN filled in and a note that details will be
   looked up later.
2. **Given** that screen, **When** I save without typing a title, **Then** the book is
   saved with a placeholder title that shows its ISBN, and it is marked **Details
   pending**.
3. **Given** a book marked Details pending, **When** the app is next open with network
   available, **Then** the lookup is retried automatically. Found details fill only the
   fields I left empty or at their placeholder values, and the mark is cleared.
4. **Given** the catalogs don't know the ISBN, **When** the lookup completes, **Then**
   I see "Not found in book catalogs" and can type the details by hand. The book is
   marked **Details not found**, and it is not retried automatically.
5. **Given** a lookup is still running, **When** it has taken more than 8 seconds,
   **Then** I can continue with what I have. The book is then treated as Details
   pending.

---

### User Story 3 - Find a book by title when there's no barcode (Priority: P2)

For a book without a usable barcode (an e-book, a library copy with a sticker over it,
an old edition), I type part of the title. Readerlog shows matching books with covers,
authors, and years. I pick the right edition, and the confirmation screen is filled in
from it.

**Why this priority**: it covers the books scanning can't reach. It is less frequent
than scanning.

**Independent Test**: search "left hand of darkness". The results include Ursula K. Le
Guin's novel. Picking it opens the filled-in confirmation screen.

**Acceptance Scenarios**:

1. **Given** the Add screen, **When** I type at least 3 characters into **Search by
   title** and submit, **Then** up to 20 matching books are listed, each with title,
   author(s), first-publication year, and a cover thumbnail where one exists.
2. **Given** results, **When** I pick one, **Then** the confirmation screen opens,
   filled in from that result.
3. **Given** no results or no network, **When** I search, **Then** I see a clear
   message, and I can **Add manually** with what I typed as the title.

---

### User Story 4 - Type an ISBN by hand (Priority: P3)

When the camera is unavailable (permission denied, no camera, a desktop browser), I
can type or paste an ISBN and get the same lookup and confirmation.

**Why this priority**: a fallback for scanning. It is also the only barcode route on
the Mac.

**Independent Test**: with camera permission denied, enter `0-441-47812-3`. It is
accepted as a valid ISBN, normalized, and looked up the same way a scan would be.

**Acceptance Scenarios**:

1. **Given** camera permission is denied or no camera exists, **When** I choose **Scan
   barcode**, **Then** I'm told why, and I'm offered **Enter ISBN** instead.
2. **Given** the ISBN field, **When** I enter a 10- or 13-digit ISBN, with or without
   hyphens or spaces, **Then** it is validated with its check digit and stored in
   13-digit form.
3. **Given** an invalid ISBN (wrong length or wrong check digit), **When** I submit it,
   **Then** it is rejected inline, and nothing is looked up.

---

### User Story 5 - Refresh details for a book already in my library (Priority: P3)

For a book I added by hand in feature 001, or one whose details came back incomplete,
I can add or correct its ISBN and ask Readerlog to fetch its details and cover.

**Why this priority**: it improves existing data. It is not needed for new books.

**Independent Test**: edit a manually added book, enter its ISBN, and choose **Look up
details**. The fetched values are offered for review before anything changes.

**Acceptance Scenarios**:

1. **Given** a book's edit screen, **When** I enter an ISBN and choose **Look up
   details**, **Then** the fetched values are shown next to the current ones, and I
   choose which to apply.
2. **Given** I apply fetched values, **When** I save, **Then** only the chosen fields
   change, and the book's reading history is untouched.

### Edge Cases

- **Scanning a barcode that isn't an ISBN** (for example a UPC price code, or a 979
  music code): it is ignored while the camera keeps looking. After 10 seconds with no
  ISBN found, a hint suggests **Enter ISBN**.
- **Scanning a book that's already in the library** (same ISBN, not removed): instead
  of creating a duplicate, I'm offered **Open existing** or **Add another copy**, for
  example to re-read a separate edition.
- **The catalogs disagree:** the first catalog that returns a title is used, and later
  catalogs only fill fields that are still missing. The user always confirms before
  anything is saved.
- **The catalog has no page count:** Total pages stays empty and editable. The finish
  prompt from 001 then doesn't appear, which is the documented behavior.
- **The page count looks wrong** (over 10,000, or zero): it is treated as missing.
- **Several authors:** they are joined as "A, B & C" into the single author field.
- **The cover image is missing, very small** (a placeholder pixel), **or fails to
  download:** the book shows a generated cover (title initials on a color) instead.
- **Several ISBNs on one book** (10- and 13-digit forms): both normalize to the same
  13-digit value, so duplicate detection still works.
- **Leaving the camera screen:** the camera is released immediately, and its indicator
  light turns off.
- **A background retry succeeds while I'm editing that book:** my unsaved edits are
  not overwritten. The fetched details are offered the next time I open the book.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Add screen MUST offer **Scan barcode** as its primary action,
  alongside **Search by title**, **Enter ISBN**, and **Add manually** (the 001 form).
- **FR-002**: Scanning MUST recognize EAN-13 book barcodes (prefixes 978 and 979) and
  ISBN-10 barcodes. It MUST work without pressing a capture button, and MUST ignore
  barcodes that aren't ISBNs.
- **FR-003**: Every ISBN MUST be validated with its check digit and stored in
  normalized 13-digit form. A 10-digit ISBN MUST be converted to its 13-digit
  equivalent.
- **FR-004**: The lookup MUST query public book catalogs in a fixed priority order.
  The first result with a title wins; lower-priority results fill only fields that are
  still missing.
- **FR-005**: A lookup MUST provide, when available: title, author(s), total pages, a
  suggested genre (from subject data), and a cover image.
- **FR-006**: The user MUST confirm (and may edit) every looked-up value before the
  book is saved. Nothing is saved automatically from a lookup.
- **FR-007**: A book MUST always be savable immediately, whatever the network or
  catalog outcome. When no title is known, the placeholder title is "ISBN
  <13 digits>".
- **FR-008**: Each book MUST carry a details status: **complete**, **pending** (the
  lookup hasn't succeeded yet), or **not found** (the catalogs answered and don't know
  the book).
- **FR-009**: Books with **pending** status MUST be retried automatically when the
  app is open and online, at most once per app launch per book. A retry MUST fill
  only fields the user left empty or at their placeholder values.
- **FR-010**: Cover images MUST be stored on the device, so they display offline. The
  total cover storage for 1,000 books MUST stay under 50 MB.
- **FR-011**: Title search MUST return up to 20 results, with title, author(s),
  first-publication year, and a thumbnail when available.
- **FR-012**: Adding a book whose ISBN matches an existing, non-removed book MUST
  offer to open the existing book instead of creating a duplicate.
- **FR-013**: The only data sent to catalogs MUST be the ISBN or the search text the
  user entered. No identifiers, reading data, or library contents are sent. Lookups
  happen only when the user acts (scan, search, look up) or for a pending retry
  (FR-009).
- **FR-014**: The camera MUST be active only while the scan view is open. Scanned
  frames MUST NOT be stored or sent anywhere.
- **FR-015**: Users MUST be able to set or change a book's ISBN and trigger a lookup
  from the edit screen, then choose which fetched fields to apply.
- **FR-016**: Every lookup outcome MUST be communicated in plain words: found, not
  found in catalogs, no network (will retry), or timed out (continue without).

### Key Entities

- **Book (Item)**, extended:
  - **ISBN**: 13-digit normalized, optional.
  - **cover reference**: a cover stored on the device, plus its source address.
  - **details status**: complete, pending, or not found.
  - Title, author, total pages, and genre as in 001.
- **Lookup Result** (transient, never stored as-is): the candidate details from one or
  more catalogs for one ISBN or search hit. It is shown for confirmation and only
  becomes Book data once the user confirms it.
- **Stored Cover**: an image kept on the device and linked to one book. It is removed
  when its book is removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From opening the Add screen to a saved book is **at most 3 taps** plus
  the scan (Scan barcode → *scan* → Save), and takes under **15 seconds** for a book
  the catalogs know, on a normal mobile connection.
- **SC-002**: For a reference set of 20 popular ISBNs (recent fiction and non-fiction,
  in English and Spanish), at least **18 of 20** return a title and author, and at
  least **15 of 20** also return a page count.
- **SC-003**: With no network, **100%** of scanned books can be saved in the same
  3-tap flow. After reconnecting, **100%** of pending books whose ISBN the catalogs
  know are filled in within one app session.
- **SC-004**: A lookup reaches an outcome (found, not found, no network, or timed out)
  within **8 seconds** in every case.
- **SC-005**: Scanning an ISBN that is already in the library never silently creates a
  duplicate: **0 duplicates** across the tested scenarios.
- **SC-006**: After saving, a book's cover displays offline in **100%** of cases where
  a cover was fetched.

## Assumptions

- **Catalogs:** Open Library, then Google Books, as named in the architecture. Both
  are free public services that don't require an account for this volume. If both
  change their terms, the manual and ISBN-only paths still work.
- **Devices:** barcode scanning targets the iPhone's rear camera in the installed web
  app. On the Mac, Enter ISBN and title search are the expected routes.
- **Genre:** a single free-text suggestion taken from catalog subjects. A curated
  genre list is out of scope. Abandon-rate-by-genre stats (feature 003) use the free
  text.
- **Covers:** a cover is downloaded once at save time, or when a retry succeeds.
  Covers aren't synced between devices in this feature; sync (004) will decide how to
  move them.
- **Status of 001 books:** books added manually in 001 count as **complete**. They are
  never retried automatically, but can be refreshed with User Story 5.
- **Placeholder title:** "ISBN <13 digits>" satisfies the 001 rule that a book has a
  non-empty title, so stats and the Library work unchanged.
- **Out of scope:** e-book or audiobook formats, series detection, translations as
  separate works, and bulk-scanning several books in one session.
