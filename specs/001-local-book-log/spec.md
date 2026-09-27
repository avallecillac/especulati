# Feature Specification: Local Book Log

**Feature Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `001-local-book-log`)

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Offline-first installable app shell with a local database;
add books manually; log reading progress with near-zero friction (pre-filled last page,
'read today' without a page, today/yesterday backdating, finish prompt at the last page);
a current-book quick-log card on the start screen; book status derived from the progress
history; mistaken entries can be undone."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log progress on the book I'm reading (Priority: P1)

I open the app and it shows the book I'm reading now, with the last page I logged
already filled in. I change the number to where I stopped and save. That's one tap on
the log button, one adjustment, and one save. If I don't know the page, I tap
**Read today** and it counts as a reading day.

**Why this priority**: this is the most frequent action in the product. Every stat
depends on it being effortless.

**Independent Test**: seed one book that is being read, open the app offline, and log
a page and a "read today". Both entries appear in the book's history under today's date.

**Acceptance Scenarios**:

1. **Given** a book being read with the last logged page 120, **When** I open the app,
   **Then** the start screen shows that book's card with "p. 120" and a log action.
2. **Given** the log sheet is open, **When** it appears, **Then** the page field is
   pre-filled with 120 and the date is set to Today.
3. **Given** the log sheet, **When** I enter 145 and save, **Then** the entry is saved
   instantly under today's local date, and the card shows "p. 145".
4. **Given** the log sheet, **When** I tap **Read today**, **Then** an entry with no
   page is saved for today, and today counts as a reading day.
5. **Given** the log sheet, **When** I choose **Yesterday** and save, **Then** the entry
   is dated yesterday's local calendar date, whatever the time now.
6. **Given** a book with 300 pages, **When** I save page 300, **Then** I am asked "Mark
   as finished?". Confirming marks the book finished. Declining leaves it being read.
7. **Given** the device is offline, **When** I do any of the above, **Then** it works
   the same way, with no error or warning.

---

### User Story 2 - Add a book manually and start reading (Priority: P1)

I add a book by typing its title. Author and total pages are optional. I can choose
**Start reading now**, so the book becomes my current book straight away.

**Why this priority**: without books there is nothing to log. Scanning comes in
feature 002, so manual entry is the MVP path.

**Independent Test**: on an empty install, add a book with "Start reading now". It
appears as the current book, and its status is Reading.

**Acceptance Scenarios**:

1. **Given** the add-book form, **When** I save with only a title, **Then** the book is
   saved with status Queued.
2. **Given** the add-book form, **When** I save with **Start reading now**, **Then** the
   book is saved with status Reading and a start entry dated today.
3. **Given** a blank or whitespace-only title, **When** I try to save, **Then** saving
   is refused with an inline message, and nothing is stored.
4. **Given** total pages entered as 0, a negative number, or a non-number, **When** I
   save, **Then** the value is rejected inline.

---

### User Story 3 - See my library and each book's history (Priority: P2)

I see all my books grouped by status: Reading, Queued, Finished, and Abandoned. Opening
a book shows its details and its dated history of entries. From there I can start,
log, finish, or abandon it.

**Why this priority**: it lets me manage more than one book and check what I logged.

**Independent Test**: seed books in each status. Check that the grouping is right and
that each book's history lists its entries, newest first.

**Acceptance Scenarios**:

1. **Given** books in several states, **When** I open the Library, **Then** each book
   appears once, under the group that matches its latest entry.
2. **Given** a queued book, **When** I tap **Start**, **Then** it moves to Reading.
3. **Given** a book being read, **When** I tap **Abandon** and confirm, **Then** it
   moves to Abandoned.
4. **Given** a finished or abandoned book, **When** I log progress or start it again,
   **Then** it returns to Reading. This supports re-reading.
5. **Given** two or more books being read, **When** I open the app, **Then** the start
   screen shows the book logged most recently. The others are one tap away.

---

### User Story 4 - Undo a mistaken entry (Priority: P2)

If I log the wrong page or date, I can remove that entry from the book's history.
Status, the current page, and all counts then behave as if I had never logged it.

**Why this priority**: mistakes would otherwise skew stats permanently.

**Independent Test**: log page 500 by mistake, then remove it. The current page goes
back to the previous value, and the reading day disappears if it was the only entry
that day.

**Acceptance Scenarios**:

1. **Given** I just saved an entry, **When** I tap **Undo** within the confirmation
   toast, **Then** the entry is removed.
2. **Given** an older entry in the history, **When** I remove it and confirm, **Then**
   it disappears from the history, and the derived status and last page are
   recalculated.
3. **Given** a removed entry, **When** I look at the stored data, **Then** a record of
   the removal is kept, so other devices can learn about it later. It is not silently
   erased.

---

### User Story 5 - Install and use it like an app, offline (Priority: P1)

I can add Readerlog to my iPhone home screen and open it full-screen. After the first
load, it opens and works with no network. My data stays on the device after I close
the app, restart the phone, or leave it unused for weeks.

**Why this priority**: local-first is the foundation (Constitution I). Everything else
builds on it.

**Independent Test**: load the app once, go offline, force-quit it, and reopen it. It
starts, and all previously entered data is present.

**Acceptance Scenarios**:

1. **Given** the app was loaded once, **When** the device is offline and I open it,
   **Then** it starts, and all data is shown.
2. **Given** data was entered, **When** the app is closed and reopened, **Then** all
   of the data is still there.
3. **Given** the first launch, **When** the app starts, **Then** it asks the browser to
   keep its storage persistent. If the browser refuses, a non-blocking notice in
   Settings says so.

### Edge Cases

- **Midnight crossing:** the sheet was opened at 23:58 and saved at 00:01. The entry
  uses the date that is selected when I save. "Today" is evaluated at save time.
- **Time zone change** while travelling: past entries keep the dates they were stored
  with, and new entries use the device's current local date.
- **Page lower than the last logged page** (rereading a section, or a typo): accepted,
  and it contributes zero pages read. It is not rejected.
- **Page greater than total pages:** rejected inline, unless total pages is unknown.
- **Total pages unknown:** the finish prompt never appears. The user finishes the book
  manually with **Finish**, which is available in the log sheet.
- **Finishing a book that was never started** (for example, one read in the past): not
  supported in this feature. Finish and Abandon require the book to be Reading.
  Recording past reading with backdated dates is deferred to a later feature, because
  every event counts as a reading day.
- **Several entries for the same book on the same day:** all are kept. They count as
  one reading day.
- **Removing a book's only start entry:** the book goes back to Queued.
- **The storage quota is reached, or storage becomes unavailable:** the save fails
  visibly, nothing is partially saved, and the user is told why.
- **Two tabs or windows open on the same device:** writes from one appear in the
  other the next time it gains focus. No data is lost.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST store all books and reading entries on the device.
  Every create, read, and remove MUST work with no network connection.
- **FR-002**: Users MUST be able to add a book with a required non-empty title, and
  an optional author, total pages (a positive whole number), and genre.
- **FR-003**: Users MUST be able to record these reading entries for a book: start,
  progress with a page, progress without a page ("read today"), finish, and abandon.
- **FR-004**: Every reading entry MUST record the calendar date on which the reading
  happened, as the user experienced it, and the exact moment it was recorded. By
  default the date is today's local date, and Yesterday MUST be selectable with one tap.
- **FR-005**: A book's status (Queued, Reading, Finished, Abandoned) MUST be derived
  from its most recent non-removed entry, and MUST NOT be editable directly.
  - No entries → Queued.
  - Start or progress → Reading.
  - Finish → Finished.
  - Abandon → Abandoned.
  - "Most recent" orders entries by reading date, then by recorded moment.
- **FR-006**: The progress log MUST pre-fill the last page logged for that book, or
  leave it empty if none has been logged.
- **FR-007**: Saving progress at a page equal to the book's total pages MUST ask
  whether to mark the book finished.
- **FR-008**: The start screen MUST show a quick-log card for the current book (the
  book being read that was logged most recently). From it, logging progress MUST take
  at most 2 taps, and "read today" MUST take at most 2 taps.
- **FR-009**: Users MUST be able to remove a mistaken entry. Removal MUST keep a record
  of the removal rather than erasing it, and all derived values MUST ignore removed
  entries.
- **FR-010**: Each user action MUST be applied all-or-nothing: either every piece of
  data it changes is stored, or none is.
- **FR-011**: Every stored change MUST be recorded in an ordered local change history,
  with enough information to replay it on another device later (for feature 004).
- **FR-012**: The app MUST be installable to the home screen, MUST open full-screen,
  and MUST start and operate fully offline after its first successful load.
- **FR-013**: The app MUST request persistent storage from the browser and MUST show
  whether it was granted.
- **FR-014**: Invalid input MUST be rejected with an inline, specific message and MUST
  NOT change stored data. Invalid input means a blank title, a non-positive or
  non-integer page or page count, a page above the known total, or a total page count
  below a page already logged for that book.
- **FR-015**: The Library MUST list every non-removed book exactly once, grouped by
  derived status. Within Reading, books MUST be ordered by most recent entry.
- **FR-016**: Users MUST be able to edit a book's title, author, total pages, and
  genre, and to remove a book. A removed book and its entries disappear from every view.

### Key Entities

- **Book (Item)**: something the user reads. It has a title, an optional author,
  optional total pages, and an optional genre, plus a created moment and an optional
  removed marker. Articles use the same entity in feature 005.
- **Reading Entry (Event)**: an append-only fact about a book. It has a kind (start,
  progress, finish, abandon), an optional page, the reading date as the user
  experienced it, the moment it was recorded, and an optional removed marker. It is
  never edited in place.
- **Change Record**: an ordered, local, append-only record of every stored change. It
  holds the originating device, an ordering stamp, and the changed fields. It is the
  basis for sync later.
- **Device Identity**: a stable, random identifier for this installation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a cold app start, the user can log progress for the current book in
  ≤ 2 taps plus the page adjustment, in under 5 seconds.
- **SC-002**: After a save, the new entry is visible in under 100 ms (perceived as
  instant) on a mid-range phone.
- **SC-003**: 100% of flows in User Stories 1–5 complete with the device in airplane
  mode.
- **SC-004**: Data survives closing the app, restarting the device, and 30 days of
  non-use on an installed home-screen app, with zero records lost.
- **SC-005**: After any sequence of add, log, and remove actions, the derived status
  and last page equal what a person would compute by hand from the non-removed
  entries, in 100% of tested sequences.
- **SC-006**: No invalid input (blank title, bad page) ever results in stored data.

## Assumptions

- There is a single user. There is no sign-in and no multi-user support.
- Barcode scanning and metadata lookup are feature 002. Stats screens are feature 003,
  though this feature must already capture everything 003 needs. Sync is feature 004,
  though this feature must already keep the change history. Articles are feature 005.
  Export and import are feature 006.
- Ratings and tags are out of scope for this feature. The data model reserves room for
  them.
- The iPhone uses a current iOS/Safari that supports installing web apps to the home
  screen, and persistent private file storage for them. On the Mac the app runs in
  current Chrome.
- A "day" is the device's local calendar day at the time of saving, unless the user
  picks Yesterday.
- English UI only.
