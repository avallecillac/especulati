# Feature Specification: Reading Stats

**Feature Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `003-reading-stats`)

**Created**: 2026-09-29

**Status**: Draft

## Clarifications

### Session 2026-09-29

- Q: Does an `abandoned` event count as a reading day? → A: Only when it carries a
  page. Abandoning gains an optional "stopped at page" field (FR-022).
- Q: How many pages does the first logged page of a read-through count for? → A: The
  full page number if the read-through began with a `started` event, otherwise 0.

**Input**: User description: "003 reading stats: on-device statistics derived from the
reading-event log. Reading days per year and a calendar heatmap, current and longest
streaks, books finished per month/year, pages read per period, reading pace (pages/day)
and estimated days to finish the current book, days-to-finish per book, and abandon
rate by genre. Correct local_date handling (backdated events, page-less events,
multiple events per day, tombstoned events and books). Articles are out of scope here
(they arrive in 005) but stats must be designed so article stats (counts, reading time
words/238, top domains) can be added separately without counting toward reading days
or streaks."

## Terms

- **Reading day**: a calendar day (the event's `local_date`) on which at least one
  counting event exists for a book that has not been removed. Which event types count
  is set by FR-002.
- **Read-through**: one pass through a book. It starts with the book's first event, or
  with the first event after a `finished` or `abandoned` event. It ends with the next
  `finished` or `abandoned` event, or is still open. A re-read is a new read-through.
- **Pages read**: the pages a user advanced, from the page numbers they logged. Rules
  are in FR-006.
- **Today**: the device's current local date, the same one used when logging.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See how many days I read this year (Priority: P1)

I open **Stats** and see the headline number: how many days I've read this year. Below
it is a calendar heatmap of the year, one square per day, marked on days I read. I see
my current streak (consecutive reading days up to today) and my longest streak ever. I
can switch to an earlier year, and I see a list of reading days for every year I have
data.

**Why this priority**: reading days per year is the app's headline stat and the reason
the log exists. On its own it is already a useful Stats screen.

**Independent Test**: log events on chosen dates (including backdated and page-less
ones), open Stats, and check the day count, the marked heatmap days, and both streaks.

**Acceptance Scenarios**:

1. **Given** events on 3 different days this year, including 2 events on one of those
   days, **When** I open Stats, **Then** it shows **3 reading days** and exactly those
   3 days are marked on the heatmap.
2. **Given** a "Read today" event with no page, **When** I open Stats, **Then** that
   day counts as a reading day.
3. **Given** I backdate an event to yesterday, **When** I open Stats, **Then** yesterday
   is marked and the counts and streaks include it.
4. **Given** I read today, yesterday, and the day before, and not the day before that,
   **When** I open Stats, **Then** the current streak is **3**.
5. **Given** I read yesterday but not yet today, **When** I open Stats, **Then** the
   current streak still includes yesterday (it is not broken until today ends).
6. **Given** my last reading day was 2 days ago, **When** I open Stats, **Then** the
   current streak is **0**, and the longest streak is unchanged.
7. **Given** an event I then remove, or a book I then remove, **When** I open Stats,
   **Then** days that only had those events are no longer reading days, and streaks are
   recomputed.
8. **Given** a streak that runs from December 30 to January 2, **When** I view either
   year, **Then** each year's day count includes only its own days, and the streak
   counts all 4 days.
9. **Given** I have never logged anything, **When** I open Stats, **Then** I see zero
   values and a short hint on how to log reading, not an error.

---

### User Story 2 - See books finished and pages read per month and year (Priority: P2)

On the same screen, for the selected year, I see how many books I finished and how
many pages I read, broken down by month. I also see pages per reading day, my average
for the year. An **All time** option shows the same totals per year.

**Why this priority**: it answers "how much did I read" once "how often" (US1) is
covered.

**Independent Test**: log a book from page 0 to the end over several days, finish it,
and check the month's books-finished count, the pages total, and pages per reading day.

**Acceptance Scenarios**:

1. **Given** I finish 2 books in March and 1 in April, **When** I view that year,
   **Then** March shows **2** books finished and April shows **1**.
2. **Given** I log pages 40, then 90, then 150 of one book on three days, **When** I
   view the month, **Then** the second and third days are credited 50 and 60 pages.
   If I started the book with **Start reading now**, the first day is credited 40
   pages; if my first entry was page 40 with no start, it is credited 0 (FR-006).
3. **Given** I log page 120 and later correct it to page 100 (a lower page), **When** I
   view pages read, **Then** the lower entry adds 0 pages and nothing is subtracted.
4. **Given** I re-read a finished book and log page 30 of the new read-through,
   **When** I view pages read, **Then** those 30 pages count for the re-read, even
   though page 30 is below the previous read-through's last page.
5. **Given** a book I then remove, **When** I view the year, **Then** its finishes and
   pages no longer count.
6. **Given** 300 pages read over 10 reading days in a year, **When** I view that year,
   **Then** pages per reading day is **30**.

---

### User Story 3 - Know when I'll finish my current book (Priority: P2)

On a book I'm reading, I see my recent pace in pages per day and an estimate: "about 6
days left, around Oct 5".

**Why this priority**: it is motivating and visible where I already log, but it needs
a page count and some logged progress, so it doesn't help every book.

**Independent Test**: log progress on a book with a known page count over several
days, then open the book and check the pace and the estimated days and date.

**Acceptance Scenarios**:

1. **Given** a 300-page book, with 140 pages read in the last 14 days, a last logged
   page of 160, and today's date, **When** I open the book, **Then** it shows a pace of
   **10 pages/day** and **14 days left**, with the date 14 days from today.
2. **Given** a book with no page count, or no logged page yet, **When** I open it,
   **Then** no estimate is shown, and the rest of the screen is unaffected.
3. **Given** no page progress in the pace window, **When** I open the book, **Then** it
   says there is no recent pace instead of showing an estimate.
4. **Given** a finished or abandoned book, **When** I open it, **Then** no estimate is
   shown.

---

### User Story 4 - Understand how I finish and abandon books (Priority: P3)

I see, per book, how many days it took me to finish, and my average across books. I
see my abandon rate overall and broken down by genre, so I can see which genres I tend
to drop.

**Why this priority**: it is reflective rather than daily, and it needs a longer
history to be meaningful.

**Independent Test**: create finished and abandoned books with and without genres,
then check days-to-finish, the average, and the abandon rate per genre.

**Acceptance Scenarios**:

1. **Given** I start a book on Mar 1 and finish it on Mar 10, **When** I view it,
   **Then** it took **10 days** (both days are counted).
2. **Given** a book started and finished on the same day, **When** I view it, **Then**
   it took **1 day**.
3. **Given** a book I finished, then re-read and finished again, **When** I view it,
   **Then** each read-through has its own days-to-finish, and both count in the
   average.
4. **Given** 3 finished and 1 abandoned book in "Fiction" and 2 finished books with no
   genre, **When** I view abandon rate, **Then** Fiction shows **25%** (1 of 4), "No
   genre" shows **0%** (0 of 2), and overall shows **17%** (1 of 6).
5. **Given** a book I abandoned and later resumed and finished, **When** I view abandon
   rate, **Then** it counts as finished, not abandoned.
6. **Given** I abandon a book today and enter "stopped at page 120" (last logged page
   90), **When** I view Stats, **Then** today is a reading day and 30 pages are
   credited to today.
7. **Given** I abandon a book today without entering a page, and log nothing else,
   **When** I view Stats, **Then** today is not a reading day.

### Edge Cases

- **Events on a day with no other activity, from a removed book:** the day stops
  counting once the book is removed.
- **Several events on one day, from several books:** the day counts once for reading
  days and streaks, and pages are summed across books.
- **A time-zone change or travel:** days follow each event's stored `local_date`, never
  the time it was recorded in UTC.
- **A future `local_date`:** it can't be entered through the app. If one arrives (for
  example through sync), it counts in its own year but is ignored when computing the
  current streak.
- **Leap years:** the heatmap shows 366 days in a leap year.
- **A book with events but a later total page count below a logged page:** already
  prevented by 001; stats never see it.
- **Very large histories (10 years, daily logging):** the Stats screen still meets
  SC-001.
- **Articles (feature 005):** they are never reading days, never extend a streak, and
  never add pages or finishes.

## Requirements *(mandatory)*

### Functional Requirements

**Scope and correctness**

- **FR-001**: Every stat MUST be computed on the device from the local event log, and
  MUST work offline. Nothing is sent anywhere.
- **FR-002**: A reading day MUST be counted for each distinct `local_date` that has at
  at least one non-removed counting event of a non-removed book. `started`, `progress`
  (with or without a page) and `finished` events always count. An `abandoned` event
  counts only when it carries a page (FR-022).
- **FR-003**: Removed events and all events of removed books MUST be excluded from
  every stat.
- **FR-004**: Every date-based stat MUST use each event's stored `local_date`. It MUST
  NOT convert the recorded time to a date at query time.
- **FR-005**: Only books count. The stats MUST be computed so that other item types
  (articles, in feature 005) can never add reading days, streak days, pages, or
  finishes. Article stats will be a separate section that 005 adds.

- **FR-006**: Pages read MUST be computed per read-through, from the page-bearing
  events (`progress`, and `abandoned` with a page) in event order (by `local_date`, then recorded time). Each entry adds its page
  minus the highest page logged earlier in the same read-through, or 0 if that is
  negative. The first page-bearing entry of a read-through adds:
  its full page number (counting from page 0) when the read-through began with a
  `started` event, or 0 when it did not (the book was picked up part-way, so the entry
  only sets a starting point).
  Pages are credited to the entry's `local_date`.

**Reading days, heatmap and streaks (US1)**

- **FR-007**: The Stats screen MUST show, for the selected year (default: the current
  year), the number of reading days and a calendar heatmap with one cell per day of
  that year, marking reading days. The heatmap MUST also convey the pages read on each
  day, using at least 3 intensity levels, with page-less reading days shown at the
  lowest level.
- **FR-008**: The Stats screen MUST show the number of reading days for every year
  that has at least one reading day, and let the user select any of those years.
- **FR-009**: The **current streak** MUST be the number of consecutive reading days
  ending today, or ending yesterday when today is not (yet) a reading day. Otherwise it
  is 0. Days after today are ignored.
- **FR-010**: The **longest streak** MUST be the longest run of consecutive reading
  days in the whole history, across year boundaries, together with its start and end
  dates.

**Books finished and pages (US2)**

- **FR-011**: For the selected year, the screen MUST show books finished and pages
  read per month, and the totals for the year. **Books finished** counts `finished`
  events, so each finished read-through counts, by the event's `local_date`.
- **FR-012**: The screen MUST show pages per reading day for the selected year: pages
  read divided by reading days, rounded to a whole number. It shows "—" when there are
  no reading days.
- **FR-013**: An **All time** view MUST show reading days, books finished, and pages
  read for each year.

**Pace and estimate (US3)**

- **FR-014**: For a book whose status is reading, the book screen MUST show its pace:
  the pages read on that book in the last 14 days up to and including today, divided by
  14. When the current read-through started less than 14 days ago, divide by the days
  since it started, counting both ends.
- **FR-015**: When the pace is above 0 and the book has a total page count and a
  logged page, the book screen MUST show the estimated days left (the remaining pages
  divided by the pace, rounded up) and the estimated finish date (today plus that many
  days). Otherwise it shows no estimate. A pace of 0 is shown as "no recent pace".

**Finishing and abandoning (US4)**

- **FR-016**: For each finished read-through, **days to finish** MUST be the number of
  calendar days from the read-through's first event to its `finished` event, counting
  both ends. The screen MUST show the average over the finished read-throughs of the
  selected year (by finish date), and the book screen MUST show each read-through's
  value.
- **FR-017**: The **abandon rate** MUST be: books whose current status is abandoned,
  divided by books whose current status is finished or abandoned. It is shown as a
  whole percentage, overall and per genre. Books with no genre are grouped as "No
  genre". A genre with no finished or abandoned books is not listed.

**Abandoning at a page**

- **FR-022**: When marking a book as abandoned, the user MUST be able to enter the page
  they stopped at, optionally. The field starts empty, showing the last logged page as
  a hint only (pre-filling it would make every abandon a reading day). The same page
  rules apply (a whole number of at least 1, and
  at most the book's page count when known). Leaving it empty keeps today's behaviour.
  Abandoning stays within the 2-tap budget: the field does not add a required step.
  This amends 001's `LogEvent`, which today rejects a page on any non-`progress`
  event.

**Presentation**

- **FR-018**: Stats MUST be reachable in one tap from the main navigation.
- **FR-019**: When a stat has no data, the screen MUST show a zero or "—" value and a
  short explanation, never an error.
- **FR-020**: Stats MUST reflect a new or removed event the next time the Stats screen
  or book screen is shown, with no manual refresh.
- **FR-021**: The heatmap MUST be usable without relying on colour alone: each day's
  date and value MUST be available to assistive technology, and the counts MUST also
  be shown as text.

### Key Entities

- **Reading day**: a date plus the pages read that day (possibly 0) for reading-day
  events. It is derived, never stored.
- **Read-through**: a book, its start date, its end date and outcome (finished,
  abandoned, or open), and the pages read in it. Derived.
- **Year summary**: a year, its reading days, books finished, pages read, pages per
  reading day, and its monthly breakdown. Derived.
- **Streak**: a start date, an end date, and a length in days. Derived.
- **Genre abandon stat**: a genre (or "No genre"), finished count, abandoned count,
  and rate. Derived.

No new stored data is needed. Everything comes from the existing books and events.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With 10 years of daily logging (about 3,650 reading days, 400 books and
  10,000 events), the Stats screen shows its numbers within 200 ms of opening on a
  mid-range phone, and switching years also takes under 200 ms.
- **SC-002**: For every fixture history in the test suite (covering backdated events,
  page-less events, several events on one day, removed events and books, re-reads and
  year boundaries), every stat matches a hand-computed expected value exactly.
- **SC-003**: After the user logs a page and opens Stats, the new reading day and pages
  are shown, with no reload and no manual refresh, 100% of the time.
- **SC-004**: The user can find this year's reading days within 1 tap of opening the
  app.
- **SC-005**: Adding article items (in any number) changes none of the book stats.

## Assumptions

- The stats screen is a new main-navigation tab; the book screen gains the pace and
  estimate for US3 and per-read-through days-to-finish for US4.
- Weeks and custom date ranges are out of scope; periods are month, year, and all time.
- Charts beyond the heatmap and the monthly breakdown (for example trend lines or goals)
  are out of scope. Reading goals may be a later feature.
- The pace window is 14 days, chosen to reflect current reading habits while smoothing
  out single busy days.
- The current streak survives until the end of today, so the user isn't shown a broken
  streak in the morning before reading.
- Days to finish counts calendar days, not reading days, because it answers "how long
  did this book take me".
- Abandon rate uses each book's current status, so a book abandoned and later finished
  counts as finished.
- Article stats (counts, reading time at 238 words per minute, top domains) are added
  by feature 005, in their own section.
- No schema change is expected. If one is needed for performance, it is a forward-only
  migration per the constitution.
