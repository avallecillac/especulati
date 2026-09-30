# Feature Specification: Article Capture

**Feature Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `005-article-capture`)

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "005 article capture: log articles I've read with near-zero
friction. On the Mac, a Chrome MV3 extension: toolbar click, keyboard shortcut, or
right-click "Log as read" collects URL, title, author, and a readability-style word
count from the live DOM (works on paywalled/logged-in pages) and saves the article with
read_on = today (local date). The extension is a write-only sync peer: it pairs with the
user's sync space using the sync code (004) and pushes article creations through the
encrypted relay (push-only runs), never pulling the whole log. On the iPhone, an iOS
Shortcut in the Safari share sheet runs JavaScript on the page to collect the same
metadata and opens https://<app>/capture#<base64url JSON>; the PWA saves it
immediately. Also: add an article manually by URL in the PWA (domain only, metadata
failed since CORS prevents fetching), an Articles list in the Library, edit/remove an
article, and a duplicate-URL warning. Articles never count toward reading days or
streaks. Article text is never stored, only derived metadata (title, author, domain,
word count). Article stats (counts per week/month, estimated reading time at 238 wpm,
top domains) are a separate section on the Stats screen."

## Terms

- **Article**: a web page I've read. It is logged once, on the day I read it, with its
  address, title, author (if known), site (domain) and approximate length in words.
  Articles have no progress entries.
- **Capture**: logging the article I'm looking at, from where I'm reading it.
- **Extension**: the Readerlog add-on for Chrome on the Mac.
- **Shortcut**: the Readerlog action in the iPhone's Safari share sheet.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log the article I'm reading on my Mac in one click (Priority: P1)

I finish an article in Chrome and click the Readerlog button in the toolbar, press the
keyboard shortcut, or right-click the page and choose **Log as read**. A small
confirmation shows the title, site and estimated reading time. The article appears in
Readerlog on my other devices after they sync.

**Why this priority**: I read most articles on the Mac. Without this, articles aren't
logged at all.

**Independent Test**: with the extension paired, capture a test page. The confirmation
shows its title and word count, and after syncing, the PWA lists it with today's date.

**Acceptance Scenarios**:

1. **Given** the extension is paired, **When** I click the toolbar button on an
   article, **Then** it is saved in one click with the page's address, title, author
   (when the page states one), site and word count, dated today (my local date), and a
   confirmation appears.
2. **Given** a page I can only read because I'm logged in (for example a paywalled
   site), **When** I capture it, **Then** the title and word count come from the page
   as I see it.
3. **Given** I'm offline, **When** I capture an article, **Then** it is kept by the
   extension and sent the next time it can reach the relay, and the confirmation says
   it will sync later.
4. **Given** I captured this address before from this browser, **When** I capture it
   again, **Then** I'm told "Already logged on <date>" and can choose **Log again** or
   **Cancel**.
5. **Given** the confirmation is showing, **When** I choose **Undo** within a few
   seconds, **Then** the capture is withdrawn and never reaches my other devices, or
   is removed everywhere if it already has.
6. **Given** the extension is not paired, **When** I open it, **Then** it asks for my
   sync code, and pairing takes a paste and one click.

---

### User Story 2 - Log an article from Safari on my iPhone (Priority: P1)

Reading in Safari on my phone, I tap Share → **Log in Readerlog**. Readerlog opens and
shows "Logged" with the title and site. I'm done.

**Why this priority**: the second main reading place, and the same near-zero friction
goal.

**Independent Test**: open the capture link the Shortcut produces, with sample data,
in the installed PWA. The article is saved and shown.

**Acceptance Scenarios**:

1. **Given** the Shortcut is installed, **When** I tap Share → **Log in Readerlog** on
   an article, **Then** Readerlog opens and saves it with the address, title, author,
   site and word count, dated today, in at most 2 taps from the share button.
2. **Given** I'm offline, **When** I capture, **Then** it is saved on the phone and
   syncs later.
3. **Given** the capture link is malformed or missing its address, **When** Readerlog
   opens it, **Then** nothing is saved and I see why, with **Add article** available.
4. **Given** I already logged that address, **When** I capture it, **Then** I see
   "Already logged on <date>" with **Log again** or **Cancel**.
5. **Given** the capture was just saved, **When** I tap **Undo**, **Then** it is
   removed.
6. **Given** the same capture link is opened twice (for example by reloading), **When**
   Readerlog opens it the second time, **Then** it isn't logged a second time.

---

### User Story 3 - See and manage the articles I've read (Priority: P2)

In the Library I switch to **Articles** and see them newest first: title, site, date
read and reading time. I can open one to edit its title, author or date read, open the
original page, or remove it. I can also add an article by pasting its address.

**Why this priority**: it makes captured data visible and correctable, but capture
works without it.

**Independent Test**: capture two articles, see them in the list, edit one's title,
remove the other, and add one by address.

**Acceptance Scenarios**:

1. **Given** captured articles, **When** I open Library → **Articles**, **Then** they
   are listed newest first with title, site, date read and estimated reading time.
2. **Given** an article, **When** I change its title, author or date read, **Then** the
   change is saved and syncs.
3. **Given** an article, **When** I remove it and confirm, **Then** it disappears here
   and on my other devices.
4. **Given** I paste an address into **Add article**, **When** I save, **Then** it is
   saved with its site, a title I type (prefilled with the site name), no word count,
   and a note that its details couldn't be fetched.
5. **Given** an address I've already logged, **When** I add it by hand, **Then** I'm
   warned as in US1·4.

---

### User Story 4 - See my article reading stats (Priority: P3)

On the Stats screen, a separate **Articles** section shows how many articles I read per
week and per month, my total estimated reading time, and my most-read sites.

**Why this priority**: nice to have. It depends on having captured data first.

**Independent Test**: create articles on known dates with known word counts, and check
each number.

**Acceptance Scenarios**:

1. **Given** 3 articles this week and 5 earlier this month, **When** I open Stats,
   **Then** it shows 3 this week and 8 this month.
2. **Given** articles of 2,380 and 1,190 words, **When** I view the stats, **Then** the
   estimated reading time is 15 minutes (3,570 ÷ 238).
3. **Given** 4 articles from one site and 2 from another, **When** I view top sites,
   **Then** they are listed with those counts, the larger first.
4. **Given** articles on days with no book reading, **When** I view reading days and
   streaks, **Then** those days are not counted.

### Edge Cases

- **Tracking parameters**: the same article reached through two links that differ
  only in tracking parameters or a `#section` counts as the same address.
- **Pages without a title**: the title falls back to the site name.
- **Very long pages** (for example an infinite-scroll feed): the word count is capped
  and the capture still works. The count covers the main article text only, not menus,
  comments or ads, as well as a readability heuristic can tell.
- **Non-article pages** (a search result, a PDF, a browser settings page): capture is
  unavailable or clearly fails. Nothing half-saved.
- **Private or incognito windows**: capture works the same.
- **Date near midnight**: the date read is the device's local date at the moment of
  capture.
- **Extension removed or unpaired**: captures not yet sent are lost only if the user
  removes the extension. Unpairing warns if any are still waiting.
- **Two devices capture the same address on the same day**: both are kept as separate
  entries, since they're separate captures. The duplicate warning appears only when
  the capturing device knows of the earlier one.
- **Books**: nothing about books changes. Book stats, reading days and streaks ignore
  articles entirely.

## Requirements *(mandatory)*

### Functional Requirements

**Capture (US1, US2)**

- **FR-001**: An article MUST be recorded with: address (normalized, FR-006), site,
  title, author (optional), word count (optional), date read (the capturing device's
  local date), and the time it was recorded.
- **FR-002**: The article's text MUST never be stored or sent anywhere. Only the
  derived details in FR-001 are kept (constitution II).
- **FR-003**: On the Mac, capture MUST be available from a toolbar button, a keyboard
  shortcut, and a right-click **Log as read** item, and each MUST save in one action
  with no further input when the extension is paired.
- **FR-004**: On the iPhone, capture from the Safari share sheet MUST take at most 2
  taps from the share button, and MUST save without further input.
- **FR-005**: Details MUST be collected from the page as the user sees it, so
  logged-in and paywalled pages work. Capture MUST NOT fetch the page again from
  anywhere else.
- **FR-006**: Addresses MUST be normalized before storing and comparing: common
  tracking parameters (for example `utm_*`, `fbclid`, `gclid`) and the `#fragment` are
  removed, and the scheme and host are lowercased.
- **FR-007**: The word count MUST estimate the main article text, excluding navigation,
  comments and similar page furniture, and MUST be capped at 100,000 words.
- **FR-008**: Before saving, capture MUST check whether the capturing device already
  knows that address. If so, it shows "Already logged on <date>" with **Log again** or
  **Cancel**.
- **FR-009**: Every capture MUST offer **Undo** for at least 5 seconds after saving.
- **FR-010**: A capture link opened more than once MUST save at most one article.

**Extension as a sync peer (US1)**

- **FR-011**: The extension MUST pair with the user's existing sync space using the
  sync code (feature 004), by paste or by scanning the QR code shown in Readerlog.
- **FR-012**: The extension MUST only send its own captures (and their undo or edits).
  It MUST NOT download or keep the rest of the reading log.
- **FR-013**: The extension MUST keep captures made while offline, or while the relay
  can't be reached, and send them later without the user doing anything.
- **FR-014**: The extension MUST show whether it is paired and how many captures are
  waiting to be sent.
- **FR-015**: Everything the extension sends MUST be end-to-end encrypted exactly like
  other devices' changes (feature 004). The extension MUST NOT send page details to
  any other service.

**iPhone capture (US2)**

- **FR-016**: Readerlog MUST accept capture links containing the article details. A
  malformed link MUST save nothing and explain why.
- **FR-017**: The Shortcut MUST be installable by following written steps in the app's
  help or README, with no paid developer account.

**Articles in the app (US3)**

- **FR-018**: Library MUST have an **Articles** view listing live articles newest first
  by date read, with title, site, date read and estimated reading time.
- **FR-019**: The user MUST be able to edit an article's title, author and date read,
  open its address, and remove it (a tombstone, never a deletion).
- **FR-020**: The user MUST be able to add an article by address. Its site is derived
  from the address; the title is typed, prefilled with the site; and it is marked as
  "details not fetched".
- **FR-021**: The title MUST be required (1–500 characters). The address MUST be an
  `http` or `https` address.

**Article stats (US4)**

- **FR-022**: The Stats screen MUST have a separate **Articles** section showing:
  articles read this week and this month, and per month for the selected year;
  estimated reading time as the total words ÷ 238, in minutes or hours; and the top 5
  sites by count.
- **FR-023**: Articles MUST NOT count toward reading days, streaks, pages read, books
  finished or any other book stat (constitution III, feature 003 FR-005).

### Key Entities

- **Article**: an item of kind "article", with address, site, title, author, word
  count, date read, details status (complete, or not fetched) and a removal marker. It
  has no progress entries.
- **Capture payload**: the details gathered on the page (address, title, author, word
  count), handed from the extension or the Shortcut to Readerlog.
- **Extension sync state**: the sync code, the captures not yet sent, and the
  addresses this extension has captured (for its duplicate warning). It is kept inside
  the extension only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Capturing an article on the Mac takes 1 click or 1 key press, and on the
  iPhone at most 2 taps after Share.
- **SC-002**: A capture made on the Mac while online appears on the phone within 10 s
  of the phone being opened or its sync button being tapped.
- **SC-003**: For a set of 20 reference article pages (saved copies, in English and
  Spanish), the captured title is correct for all 20 and the word count is within 15%
  of a hand count for at least 18.
- **SC-004**: No article text leaves the device: inspecting everything sent to the
  relay shows only encrypted data, and decrypted captures contain only the FR-001
  details.
- **SC-005**: Book reading days, streaks and all other book stats are identical before
  and after adding any number of articles.
- **SC-006**: A capture made offline on either device reaches the other devices,
  without user action, once both have been online.

## Assumptions

- The extension is installed "unpacked" in Chrome on the Mac. Publishing it to the
  Chrome Web Store is optional and out of scope.
- The iPhone Shortcut is built by the user from written instructions (a short script
  plus an "Open URL" step). Shortcuts can't be signed or distributed without an Apple
  developer account, so a ready-made file isn't promised.
- Holding the sync code lets the extension read the whole log in principle; the
  requirement is that it doesn't (FR-012). A write-only key isn't possible with the
  004 key design.
- The duplicate warning uses what the capturing device knows: the full library on
  the PWA, and its own capture history in the extension.
- Weeks start on Monday for "this week".
- Reading time uses 238 words per minute, as in the architecture.
- No article tags, notes, ratings or reading queue in this feature.
