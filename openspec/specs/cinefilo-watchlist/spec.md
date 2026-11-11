# cinefilo-watchlist Specification

## Purpose
Keeps the shared state of every title, from watch later to watched, so both members see the same lists and can move titles between them from any device.

## Requirements

### Requirement: One shared status per title
Each title SHALL have exactly one status shared by both members:
- `later` for movies and series;
- `watching` for series only;
- `watched` for movies and series;
- `dropped` for series only.

A newly added title SHALL start as `later` unless the member picks another status while adding it.

#### Scenario: New title defaults to later
- **WHEN** a member adds a movie without choosing a status
- **THEN** it appears in Watch later for both members

#### Scenario: Movies cannot be watching or dropped
- **WHEN** a member tries to set a movie to watching or dropped
- **THEN** the system rejects the change and the movie keeps its status

### Requirement: Lists by status
The system SHALL show three lists:
- **Watch later:** status `later`, newest added first.
- **Watching:** status `watching`.
- **Watched:** status `watched` or `dropped`, most recently watched first. Dropped series are marked as dropped.

Every list SHALL be available offline.

#### Scenario: Lists offline
- **WHEN** the device is offline and a member opens any list
- **THEN** the list shows every title with that status from the local data

#### Scenario: Status change moves the title
- **WHEN** a member marks a title in Watch later as watched
- **THEN** it leaves Watch later and appears in Watched on both members' devices after sync

### Requirement: Mark as watched with a date
Marking a title as watched SHALL record a watched date, which is the calendar day on the marking device. The date defaults to today, and "Yesterday" or any earlier day is available. A title SHALL keep a single watched date; marking it watched again replaces the date.

#### Scenario: Mark watched today
- **WHEN** a member marks a movie watched with the default date
- **THEN** its watched date is today's date in the device's timezone

#### Scenario: Backdate
- **WHEN** a member marks a movie watched and picks a date three days earlier
- **THEN** its watched date is that earlier day

#### Scenario: Back to later clears nothing it shouldn't
- **WHEN** a watched title is moved back to Watch later
- **THEN** its watched date is cleared, and both members' verdicts and reviews remain

### Requirement: Series progress
A series SHALL optionally hold a current season number, from 1 up to its season count when the count is known. The current season SHALL be shown in the Watching list.

#### Scenario: Set current season
- **WHEN** a member sets a watching series' current season to 3
- **THEN** both members see "Season 3" on that series

#### Scenario: Season out of range
- **WHEN** a member sets the current season to a number below 1, or above a known season count
- **THEN** the system rejects the change

### Requirement: Concurrent status changes converge
When both members change the same title's status or watched date while offline, the system SHALL settle every device on the same value: the change made last. Changes to different fields of the same title SHALL all be kept.

#### Scenario: Both change status offline
- **WHEN** one member marks a series watched while the other, offline, marks it dropped, and the dropped change is later
- **THEN** after sync both devices show the series as dropped

#### Scenario: Status and season changed at once
- **WHEN** one member sets a series' current season to 2 while the other marks the same series watching
- **THEN** after sync both devices show it watching, in season 2

### Requirement: Remove and restore a title
A member SHALL be able to remove a title from the shared catalog, with an Undo. Removal SHALL hide the title, with its ratings, from every list on both members' devices. Restoring it SHALL bring them all back.

#### Scenario: Remove with undo
- **WHEN** a member removes a title and taps Undo
- **THEN** the title and both members' ratings are back in their list

#### Scenario: Removed on one device, edited on the other
- **WHEN** one member removes a title while the other, offline, rates it, and the rating is later than the removal
- **THEN** after sync the title stays removed on both devices, and the rating is kept, so a later restore shows it
