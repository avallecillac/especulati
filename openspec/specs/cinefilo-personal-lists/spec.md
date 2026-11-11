# cinefilo-personal-lists Specification

## Purpose
TBD - created by archiving change personal-lists. Update Purpose after archive.

## Requirements

### Requirement: Personal status per member
Each member SHALL be able to give any title a personal status (Watch later, Watching for series, Watched with an optional date) and, for series, a personal current season, independent of the title's Together status and of the partner's personal status.

#### Scenario: Watch solo
- **WHEN** a member marks a series as Watching on their own list, at season 2
- **THEN** their list shows it at season 2, and its Together status and season do not change

#### Scenario: Together title watched solo
- **WHEN** a title is on Together as Watch later and one member marks it Watched on their own list
- **THEN** it stays on Together as Watch later

### Requirement: Only the owner edits a personal list
A device SHALL write personal statuses only for the member it acts as. The partner's list SHALL be shown read-only, without edit controls.

#### Scenario: Partner's list is view-only
- **WHEN** a member opens the partner's list
- **THEN** the screen says it is the partner's list and view-only, and offers no status, season or remove controls

#### Scenario: Independent edits never conflict
- **WHEN** both members change their own status for the same title while offline
- **THEN** after sync both devices show both personal statuses as set, and the Together status is unchanged

### Requirement: The list switch
The list screens SHALL offer a switch between Together, the member's own list and the partner's list, opening on Together. The current list SHALL always be named on screen.

#### Scenario: Default view
- **WHEN** a member opens the app
- **THEN** the Together list is shown

#### Scenario: Whose list is on screen
- **WHEN** a member switches to the partner's list
- **THEN** the header names the partner and the list is visibly marked as theirs

### Requirement: Add to a list
Adding a title SHALL ask whether it goes to Together or "Just me", defaulting to the list on screen (Together when the partner's list is on screen).

#### Scenario: Add just for me
- **WHEN** a member adds a film with "Just me" and Watch later
- **THEN** it appears on their own Watch later list and not on Together

#### Scenario: Already in the catalog
- **WHEN** a member adds "Just me" a film that is already on Together
- **THEN** the film gets a personal status and is not duplicated

### Requirement: All three statuses on the title screen
The title screen SHALL show the Together status, the member's own status and the partner's status, and let the member set their own.

#### Scenario: Three statuses
- **WHEN** a member opens a title that is Watch later on Together, Watched on their own list and absent from the partner's
- **THEN** the screen shows all three, the partner's as "not on their list"

### Requirement: Recommend to the partner
A member SHALL be able to recommend a title to the partner. The title SHALL then appear on the partner's list as recommended by the member, until the partner accepts it (gives it a personal status) or dismisses it. A member SHALL be able to withdraw their own recommendation.

#### Scenario: Recommend
- **WHEN** a member recommends a film they watched alone
- **THEN** after sync the partner's list shows it as "Recommended by <member>" with Accept and Dismiss

#### Scenario: Accept
- **WHEN** the partner accepts the recommendation
- **THEN** the film is on the partner's Watch later list and is no longer shown as a pending recommendation

#### Scenario: Dismiss
- **WHEN** the partner dismisses the recommendation
- **THEN** it disappears from the partner's list, and the recommender still sees that it was dismissed

### Requirement: Personal data is exported
Export and import SHALL include personal statuses and recommendations, losslessly, merging by id.

#### Scenario: Round trip
- **WHEN** a member exports and imports into an empty database
- **THEN** both members' personal lists and all recommendations are identical to the original
