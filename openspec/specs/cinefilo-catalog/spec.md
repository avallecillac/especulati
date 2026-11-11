# cinefilo-catalog Specification

## Purpose
Lets the two members add movies and series to their shared catalog, by hand or from TMDB, without ever needing the network to record a title.

## Requirements

### Requirement: Add a title by hand
The system SHALL let a member add a movie or a series by typing a title, choosing its kind, and optionally giving a year. Adding SHALL complete locally with no network access.

#### Scenario: Add a movie offline
- **WHEN** a member with no network connection types "Stalker", picks Movie and year 1979, and saves
- **THEN** the title appears in Watch later on that device immediately
- **AND** it syncs to the partner's devices once either device is back online

#### Scenario: Blank title rejected
- **WHEN** a member tries to save a title that is empty or only whitespace
- **THEN** the system does not save it and says that a title is required

### Requirement: Same title added twice converges to one entry
The system SHALL treat two additions of the same title as one entry, even when they happen on different devices while offline. Same title means the same TMDB id and kind or, for manual entries, the same normalized title, kind and year.

#### Scenario: Both partners add the same film offline
- **WHEN** both members, each offline, add "In the Mood for Love" (Movie, 2000) from TMDB on their own devices
- **AND** both devices later sync
- **THEN** each device shows exactly one "In the Mood for Love" entry

#### Scenario: Manual duplicates differing only in case and accents
- **WHEN** one member adds "Amélie" (Movie, 2001) by hand, and the other adds "amelie" (Movie, 2001) by hand
- **THEN** after sync both devices show a single entry

#### Scenario: Same name, different kind or year stays separate
- **WHEN** a member adds "Solaris" (Movie, 1972), and later "Solaris" (Movie, 2002)
- **THEN** the catalog holds two separate entries

#### Scenario: Re-adding an existing title
- **WHEN** a member adds a title that is already in the catalog
- **THEN** the system opens the existing entry instead of creating a second one

### Requirement: Search TMDB to add a title
When a TMDB API key is configured and the device is online, the system SHALL offer search by title across movies and series. Picking a result SHALL add it with TMDB's details. A title SHALL be added in at most 2 taps after the results appear.

#### Scenario: Add from search
- **WHEN** a member searches "Severance", sees the series result, and taps Add
- **THEN** the series is added to Watch later with its year, genres, season count and poster

#### Scenario: Search without key or network
- **WHEN** no TMDB key is configured, or the device is offline
- **THEN** the add sheet offers only manual entry and says why search is unavailable
- **AND** manual add still works

#### Scenario: TMDB fails or times out
- **WHEN** a TMDB request errors or takes longer than 8 seconds
- **THEN** the system shows the failure as a non-blocking message and keeps the typed text for manual entry

### Requirement: TMDB key stays on the device
The system SHALL store the TMDB API key only on the device where it was entered. It SHALL NOT include the key in synced data, exports or error messages.

#### Scenario: Key not shared with partner
- **WHEN** one member enters a TMDB key and the devices sync
- **THEN** the partner's devices have no TMDB key until the partner enters one

#### Scenario: Key absent from export
- **WHEN** a member exports their data
- **THEN** the export file contains no TMDB key

### Requirement: Match a manual title to TMDB later
The system SHALL let a member link a title that was added by hand to a TMDB result. This fills in the empty details and keeps the same entry, with its status and every rating.

#### Scenario: Link keeps ratings
- **WHEN** a manual title that both members have rated is linked to its TMDB result
- **THEN** the entry keeps its status, watched date and both verdicts and reviews, and gains the TMDB year, genres and poster

#### Scenario: Link would duplicate an existing entry
- **WHEN** a member links a manual title to a TMDB result that is already another entry in the catalog
- **THEN** the system merges the two into one entry, keeping the status that was changed most recently and each member's most recent verdict
- **AND** both devices end up with the same single entry

### Requirement: Edit title details
The system SHALL let a member edit a title's name, original title, year, genres, runtime (movies) or season count (series). Each edit SHALL sync to the partner.

#### Scenario: Concurrent edits to different fields
- **WHEN** one member changes a title's year while the other, offline, changes its genres
- **THEN** after sync both devices show both changes

#### Scenario: Concurrent edits to the same field
- **WHEN** both members change the same title's year to different values while offline
- **THEN** after sync both devices show the same value: the edit made last

### Requirement: Posters cached on device
The system SHALL cache each TMDB poster on the device, so posters show offline once they are cached. Poster images SHALL NOT be synced. Titles without a poster SHALL show a generated placeholder.

#### Scenario: Poster offline
- **WHEN** a poster has been fetched once, and the device later opens offline
- **THEN** the poster still shows

#### Scenario: Partner device fetches its own poster
- **WHEN** a TMDB-added title syncs to the partner's device
- **THEN** that device fetches and caches the poster from the synced poster address the next time it is online, with no image data in the sync

### Requirement: TMDB attribution
Whenever TMDB is configured, the system SHALL show TMDB's attribution notice and logo in the app's About or Settings screen, saying the product uses the TMDB API but is not endorsed or certified by TMDB.

#### Scenario: Attribution visible
- **WHEN** a member opens Settings → About
- **THEN** the TMDB attribution notice and logo are shown
