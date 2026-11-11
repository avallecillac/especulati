# Spec Delta

## Purpose

Gives each member their own verdict and short review for any title, independent of the partner's, and lets both compare their opinions and filter by them.

## ADDED Requirements

### Requirement: One verdict per member per title
Each member SHALL be able to give each title one verdict: like, meh or didn't like. Choosing a verdict SHALL take one tap on the title's screen, and it SHALL be saved locally at once.

#### Scenario: Rate in one tap
- **WHEN** a member opens a watched movie and taps "Like"
- **THEN** their verdict is saved as like, with no further confirmation

#### Scenario: Change or clear own verdict
- **WHEN** a member taps "Meh" on a title they had liked, or taps their selected verdict again
- **THEN** their verdict becomes meh, or becomes cleared, respectively

#### Scenario: Rate offline
- **WHEN** a member rates a title while offline
- **THEN** the verdict shows at once and reaches the partner after the next sync

### Requirement: Optional short review
Each member SHALL be able to write one review per title, of at most 1,000 characters, alongside or without a verdict. A review that is empty after trimming SHALL count as no review.

#### Scenario: Review too long
- **WHEN** a member enters a review longer than 1,000 characters
- **THEN** the system does not save it and shows the limit

#### Scenario: Review without verdict
- **WHEN** a member writes a review but picks no verdict
- **THEN** the review is saved, and their verdict stays empty

### Requirement: Members edit only their own rating
A device SHALL write verdicts and reviews only as the member it is set up as. The system SHALL reject any local attempt to change another member's verdict or review.

#### Scenario: Partner's rating is read-only
- **WHEN** a member opens a title the partner has reviewed
- **THEN** the partner's verdict and review are shown, and cannot be edited from this device

### Requirement: Independent ratings never conflict
Both members SHALL be able to rate the same title at the same time, online or offline, and every device SHALL keep both ratings without one overwriting the other.

#### Scenario: Both rate offline
- **WHEN** both members rate the same film while offline, one "Like" and the other "Didn't like"
- **THEN** after sync both devices show both verdicts side by side

#### Scenario: Same member on two devices
- **WHEN** one member rates a title "Like" on the phone, then "Meh" on the laptop, while both are offline
- **THEN** after sync both devices show that member's verdict as whichever was chosen last

### Requirement: Both members' ratings visible
A title's screen SHALL show both members' verdicts and reviews side by side, labelled with each member's name. A missing rating SHALL show as "not rated yet".

#### Scenario: Side by side
- **WHEN** a member opens a title both have rated
- **THEN** the screen shows each member's name with their verdict and review

### Requirement: Filter by verdicts
The lists SHALL be filterable by verdict agreement:
- both liked;
- both rated but disagree;
- rated by me only;
- the partner hasn't rated yet;
- nobody rated yet.

Filters SHALL work offline.

#### Scenario: Both liked
- **WHEN** a member applies "Both liked" to Watched
- **THEN** only titles where both members' verdict is like are listed

#### Scenario: Partner hasn't rated
- **WHEN** a member applies "Partner hasn't rated" to Watched
- **THEN** only watched titles with no verdict from the partner are listed
