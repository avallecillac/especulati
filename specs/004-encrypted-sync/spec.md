# Feature Specification: Encrypted Sync

**Feature Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `004-encrypted-sync`)

**Created**: 2026-09-29

**Status**: Draft

## Clarifications

### Session 2026-09-29

- Q: Should an open device pull changes in the background (polling) to meet the 10 s
  target? → A: Not for the MVP. A sync button in the top bar lets the user pull on
  demand, alongside the automatic triggers (open, brought to front, back online, after
  local changes). Background polling may come later.

- Q: When a device joins and both devices already have books, how are duplicates
  handled? → A: Combine everything, then offer to merge likely duplicates (same ISBN,
  or same title and author). The user chooses **Merge** or **Keep both** for each. On
  Merge, the copy added first survives, receives every entry from the other with its
  original dates, and has its empty fields filled from the other copy. The survivor is
  chosen the same way on every device, and merging the same pair on two devices gives
  the same result.

**Input**: User description: "004 encrypted sync: keep the reading log identical across
my devices (iPhone PWA, Mac Chrome PWA, later the Chrome extension) through a tiny relay
on Cloudflare Worker + D1 that only ever sees ciphertext. First device creates a sync
space (256-bit secret); other devices join by scanning a QR code or pasting a pairing
code. Each device pushes its change_log ops encrypted end-to-end and pulls others' ops,
merging per-field last-writer-wins on HLC plus a union of events; tombstones win by
later HLC. Sync runs on app open, when the app becomes visible, after writes (debounced)
and when coming back online, and is fully optional: offline everything still works.
Includes: sync status in Settings (last synced, pending changes, errors), leaving a
space on a device, and a full reset that creates a new space so old data is never
merged back. Local-only data (covers, the Google Books API key, device settings) never
syncs. Convergence tests: N peers with the same ops in any order and with duplicates
reach identical state. Relay stays within Cloudflare free tier for one user."

## Terms

- **Sync space**: the shared, encrypted copy of one reading log. It is identified and
  unlocked by a single secret, the **sync code**. Every device that holds the code can
  read and add to the space. Nobody else can, including the relay's operator.
- **Sync code**: the secret that lets a device join a space. It is shown as a QR code
  and as a text code that can be pasted.
- **Relay**: a small online service that stores and forwards encrypted changes between
  devices. It cannot read them.
- **Change**: one recorded edit on a device, such as adding a book, logging a page, or
  removing an entry. Changes already exist for every edit made since feature 001.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn on sync and join my second device (Priority: P1)

On my iPhone I open Settings → Sync and tap **Turn on sync**. It creates my sync space
and shows a QR code and a text code. On my Mac I open Settings → Sync, tap **Join**,
and paste the code (or, the other way round, scan the Mac's QR with the phone). Within
a few seconds both devices show the same library, events and stats.

**Why this priority**: without it nothing syncs. It is also the only step with any
friction, so it must be simple and hard to get wrong.

**Independent Test**: turn on sync on device A, which has books, then join device B.
B shows A's books and events, and A shows anything B had.

**Acceptance Scenarios**:

1. **Given** sync is off, **When** I tap **Turn on sync**, **Then** a sync space is
   created, and the screen shows a QR code, a text code, and advice to save the code
   somewhere safe (for example a password manager), because it is the only way to
   recover the space.
2. **Given** device A has a sync space, **When** device B joins with A's code, **Then**
   within 10 s (both online) B shows every book and event from A.
3. **Given** both devices already had their own books before B joined, **When** B
   joins, **Then** the two logs are combined as described in FR-011.
4. **Given** I paste a code with a typo, **When** I tap **Join**, **Then** I am told the
   code is invalid, and nothing on the device changes.
5. **Given** a valid-looking code for a space that does not exist, **When** I join,
   **Then** I am told no space was found, and nothing changes.
6. **Given** a device has sync on, **When** I open Settings → Sync, **Then** I can show
   the code again to add another device.

---

### User Story 2 - Changes flow between devices automatically (Priority: P1)

I log a page on my phone on the train. When I open the app on my Mac later, the page
is there, without me doing anything. If I edit a book on both devices while one is
offline, the most recent edit to each field wins, and no entry is lost.

**Why this priority**: it is the reason sync exists.

**Independent Test**: with two paired devices, make changes on each, including offline
and conflicting ones, then bring both online and compare.

**Acceptance Scenarios**:

1. **Given** paired devices, **When** I log a page on A, **Then** B shows it the next
   time B is opened or brought to the front, or within 10 s of my tapping the sync
   button on B. There is no background polling in this version.
2. **Given** A is offline, **When** I log 3 entries on A and then A comes back online,
   **Then** they reach B with no action from me, and the entries keep their original
   dates.
3. **Given** I change a book's title on A and its page count on B while both are
   offline, **When** both sync, **Then** both devices show the new title **and** the
   new page count.
4. **Given** I change the same book's title on A and then, later, on B, while both are
   offline, **When** both sync, **Then** both devices show B's title (the later edit).
5. **Given** I log entries on the same book on both devices while offline, **When**
   both sync, **Then** both devices show all the entries, and the book's status and
   last page are derived from all of them.
6. **Given** I remove a book on A, **When** B syncs, **Then** the book disappears on B
   too. If B had edited it earlier than the removal, it stays removed.
7. **Given** the relay is unreachable, **When** I use the app, **Then** everything works
   locally, and the changes sync later.

---

### User Story 3 - See whether sync is healthy (Priority: P2)

In Settings → Sync I see when the device last synced, how many of its changes are
waiting to be sent, and any problem in plain words ("Offline — changes will be sent
later", "Sync code no longer valid"). I can tap **Sync now**.

**Why this priority**: sync that fails silently is worse than no sync, but the core
flows work without this screen.

**Independent Test**: make changes offline and check the pending count; go online and
check it drops to 0 and the time updates; simulate a relay error and check the message.

**Acceptance Scenarios**:

1. **Given** 3 changes made offline, **When** I open Settings → Sync, **Then** it shows
   "3 changes waiting to sync".
2. **Given** a successful sync, **When** I open Settings → Sync, **Then** it shows
   "Last synced: just now" (or a relative time), and 0 changes waiting.
3. **Given** the relay rejects the device (for example the space was reset elsewhere),
   **When** sync runs, **Then** Settings shows what happened and what to do, and the
   app keeps working locally.
4. **Given** sync is on, **When** I tap **Sync now**, **Then** a sync runs immediately
   and the status updates.

---

### User Story 4 - Leave a space, or start over (Priority: P3)

If I stop using a device, I tap **Leave sync space** on it. The device keeps its data
but stops syncing. If I lose a device, or want to throw away the shared history, I tap
**Reset sync** on a device I trust. It creates a new space with a new code and uploads
this device's current data. The lost device can no longer read or add anything, and
the old data can never be merged back.

**Why this priority**: rare, but necessary for safety and for recovering from mistakes.

**Independent Test**: leave on one device and check it stops syncing; reset on another,
join a third device with the new code, and check the old code no longer works.

**Acceptance Scenarios**:

1. **Given** a paired device, **When** I tap **Leave sync space** and confirm, **Then**
   it stops syncing, keeps all its local data, and forgets the code. The other devices
   are unaffected.
2. **Given** devices A, B and C share a space, **When** I tap **Reset sync** on A and
   confirm, **Then** A gets a new space and code, uploads its current data, and the
   old space is deleted from the relay.
3. **Given** a reset happened on A, **When** B next syncs with the old code, **Then** B
   is told the space no longer exists and is asked to join again with the new code. B
   keeps its local data.
4. **Given** B rejoins with A's new code, **When** it syncs, **Then** B's local data is
   combined per FR-011, so nothing B still has locally is lost.

### User Story 5 - Merge books I added on both devices (Priority: P2)

After my Mac joins, the app tells me "3 books may be duplicates". For each, I see both
copies side by side (title, author, ISBN, number of entries, date added) and choose
**Merge** or **Keep both**.

**Why this priority**: both of your devices already have books, so duplicates are
likely on the first join. But sync works without it, and duplicates can be merged
later from Settings.

**Independent Test**: add the same book on two unsynced devices and log on each, join
them, then merge. One book remains, with every entry from both.

**Acceptance Scenarios**:

1. **Given** *Dune* (same ISBN) was added on A on Mar 1 and on B on Mar 5, each with
   entries, **When** B joins and I choose **Merge**, **Then** one *Dune* remains on
   both devices: the Mar 1 copy, holding the entries from both, and its status and
   last page reflect all of them.
2. **Given** the Mar 1 copy has no page count and the Mar 5 copy has 412, **When** I
   merge, **Then** the survivor has 412 pages.
3. **Given** two books with the same title and author but different ISBNs (different
   editions), **When** the list is built, **Then** they are not offered.
4. **Given** I choose **Keep both** for a pair, **When** duplicates are checked again on
   any device, **Then** that pair is not offered again.
5. **Given** I merge the same pair on A and on B before they sync, **When** they sync,
   **Then** both show one book with each entry exactly once.

### Edge Cases

- **Both devices offline for weeks:** everything merges when they reconnect, with
  nothing lost and the same result on both.
- **The same change arriving twice** (a retry after a timeout): applied once.
- **Changes arriving out of order:** the final result is the same as in order.
- **A device's clock is wrong** (hours or days ahead): the merge still works, and a
  device never makes its own later edits lose because of a skewed clock it received.
- **A sync interrupted halfway** (app closed, network drops): no partial state; the next
  sync picks up where it left off.
- **Two tabs open on the Mac:** only the tab holding the database syncs.
- **A very large first upload** (years of history on the first device): it completes in
  batches, and the app stays usable while it runs.
- **The relay loses or corrupts data:** each device still has its full local copy. A
  change that cannot be decrypted or read is skipped and reported, never applied.
- **A synced book's cover:** covers are not synced. A device that receives a book with
  a cover address downloads and caches the cover itself when online.
- **The Google Books key, covers and device settings** stay on each device.
- **The sync code on screen:** it is shown only when the user asks, and it is hidden
  again when they leave the screen.

## Requirements *(mandatory)*

### Functional Requirements

**Privacy and security**

- **FR-001**: Everything a device sends to the relay about the reading log MUST be
  encrypted on the device with a key only the user's devices hold. The relay MUST NOT
  be able to read titles, authors, pages, dates, genres, ISBNs, or any other domain
  data, nor which items or events a change is about.
- **FR-002**: The relay MUST refuse to read or write a space for anyone who does not
  hold its sync code.
- **FR-003**: The sync code MUST be long and random enough that it cannot be guessed
  (at least 256 bits of randomness), and it MUST never be sent to the relay itself.
- **FR-004**: Local-only data MUST never leave the device through sync: cached cover
  images, the Google Books API key, storage and device settings, and the device's sync
  code and sync state.
- **FR-005**: The relay MUST keep no analytics or logs of domain data, and store only
  what it needs to forward changes (constitution II).

**Pairing (US1)**

- **FR-006**: A device without sync MUST be able to create a new space, and then show
  its sync code as both a QR code and a text code.
- **FR-007**: A device without sync MUST be able to join a space by scanning a QR code
  with its camera or by pasting the text code. A malformed code MUST be rejected before
  anything changes, and a code for an unknown space MUST be reported as such.
- **FR-008**: A device with sync on MUST be able to show its code again on request.

**Sending and receiving (US2)**

- **FR-009**: Every change recorded on a device MUST eventually reach every other device
  in the space, once each of them has been online at the same time as the relay.
- **FR-010**: Receiving changes MUST produce the same result regardless of the order
  in which they arrive or how many times each arrives. The merge rules are:
  - for each field of each record, the most recent edit wins, with "most recent"
    decided by the order in which edits were made across devices, not by arrival;
  - reading entries from all devices are all kept;
  - a removal is a field edit like any other, so a later removal wins over an earlier
    edit, and a later restore (if one ever exists) wins over an earlier removal.
- **FR-011**: When a device joins or rejoins a space that already has data, its
  existing local data MUST be combined with the space's data using the same rules.
  Nothing on either side is discarded. Likely duplicates are then offered for merging
  (FR-026 to FR-029).
- **FR-012**: Received changes MUST be applied all-or-nothing per batch, and a batch
  that fails to apply MUST leave the local data unchanged and be retried later.
- **FR-013**: A received change that cannot be decrypted or understood (corrupt, or
  from a newer app version) MUST NOT be applied. The device MUST keep syncing everything
  else, and report the problem in the sync status.
- **FR-014**: Sync MUST run automatically when the app opens, when it comes to the
  front, shortly after local changes (at most a few seconds later, grouping bursts),
  and when the device comes back online. It MUST never block the user, and every
  screen MUST work while a sync is running or failing.
- **FR-015**: Stats, the library and the book screens MUST reflect received changes
  without a manual reload.
- **FR-016**: A device that receives a book with a cover address and has no cached
  cover MUST download and cache it when online, as for books it added itself.

**Duplicate books after joining (US5)**

- **FR-026**: After a device joins or rejoins a space, and whenever the user asks from
  Settings → Sync, the app MUST list pairs of live books that are likely the same:
  - the same ISBN; or
  - no ISBN on at least one of them, and the same title and author, compared ignoring
    case, accents, punctuation and extra spaces.

  A pair the user has marked **Keep both** MUST NOT be offered again, on any device.
- **FR-027**: For each pair, the user MUST be able to choose **Merge** or **Keep both**.
  Nothing is merged without that choice.
- **FR-028**: **Merge** MUST:
  - keep the copy that was added first, by the time it was added, with ties broken the
    same way on every device;
  - carry over every entry of the other copy to it, keeping each entry's day and time,
    so the reading history, status, last page and stats are as if everything had been
    logged on one book;
  - fill the survivor's empty fields (author, page count, genre, ISBN, cover) from the
    other copy, without overwriting anything already set;
  - remove the other copy.
- **FR-029**: Merging the same pair on two devices, even at the same time, MUST end with
  the same single book and the same entries on every device, with no doubled entries.

**Status (US3)**

- **FR-017**: Settings → Sync MUST show: whether sync is on; the time of the last
  successful sync; the number of local changes not yet sent; and the latest problem,
  in plain words, with what to do about it.
- **FR-018**: The user MUST be able to trigger a sync immediately with one tap on a sync
  button that is always visible in the app's top bar while sync is on. The button shows
  when a sync is running. Settings → Sync also offers **Sync now**.

**Leaving and resetting (US4)**

- **FR-019**: **Leave sync space** MUST stop syncing on that device and forget its
  code, keeping all local data. It asks for confirmation.
- **FR-020**: **Reset sync** MUST create a new space with a new code, upload this
  device's full current data to it, and delete the old space from the relay. It asks
  for confirmation, and explains that other devices must rejoin with the new code.
- **FR-021**: A device whose space no longer exists MUST stop syncing, keep its local
  data, and tell the user to rejoin with a new code.
- **FR-022**: Data from a deleted space MUST never be merged into a new space by the
  relay. Only a device the user explicitly rejoins brings its local data in (FR-011).

**Relay**

- **FR-023**: For one user with a few devices, the relay MUST stay within the hosting
  provider's free allowance.
- **FR-024**: The relay MUST limit requests per space, so that a misbehaving device
  can't run up usage.

**Future devices**

- **FR-025**: The pairing and change format MUST allow a later capture-only device
  (the Chrome extension, feature 005) to join and send changes without receiving the
  whole log.

### Key Entities

- **Sync space**: a space identity plus everything stored for it on the relay (the
  encrypted changes, in the order received). It is created by one device and deleted
  by a reset.
- **Sync code**: the secret that identifies a space and decrypts it. It is held only on
  the user's devices.
- **Encrypted change batch**: a group of a device's changes, sealed so the relay sees
  only its size and when it arrived.
- **Device sync state**: per device, whether sync is on, the code, how far it has
  received, which local changes have been sent, the last sync time, and the last
  problem. It is local only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pairing a second device takes under 1 minute and at most 5 taps or clicks
  on the new device, starting from Settings.
- **SC-002**: With both devices online, a change on one appears on the other within 10 s
  of the other device being opened, brought to the front, or its sync button being
  tapped, in 95% of attempts.
- **SC-003**: In automated tests, any number of devices (2 to 5) that receive the same
  changes in any order, with duplicates, end with identical data, every time
  (1,000 randomized runs).
- **SC-004**: A first sync of 10 years of history (about 10,000 changes) completes in
  under 1 minute on a normal connection, and the app stays usable meanwhile.
- **SC-005**: An inspection of everything the relay stores shows no readable title,
  author, date, page number or other domain value.
- **SC-006**: With sync on and the network off, every existing flow still works, with
  no errors other than the sync status message.
- **SC-007**: One user with 3 devices and daily use for a year stays within the relay
  host's free allowance.

## Assumptions

- There is one user; every device in a space belongs to that user. There are no
  accounts, sharing, or permissions.
- Holding the sync code is the only credential. A user who loses every device **and**
  the code loses the shared copy; the app says so when sync is turned on.
- Changes made before sync was turned on (since feature 001) are uploaded on the first
  sync.
- The relay keeps every change for the life of the space; compaction is out of scope.
- The Chrome extension (005) and export/import (006) build on this, but their flows are
  not part of this feature.
- The camera is only needed to scan a QR code; pasting always works (for example on a
  Mac with no camera).
- A device that is offline, or whose relay is unreachable, is a normal state, not an
  error.
