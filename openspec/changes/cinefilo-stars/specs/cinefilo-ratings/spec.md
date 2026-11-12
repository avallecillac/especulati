## ADDED Requirements

### Requirement: Star rating per member per title
Each member SHALL be able to rate each title from 0.5 to 5 stars in half-star steps, with one tap or drag on the title's screen, saved locally at once. A member SHALL be able to clear their own rating. Ratings given before stars existed SHALL show as not rated.

#### Scenario: Rate with a tap
- **WHEN** a member taps the left half of the fourth star
- **THEN** their rating is saved as 3.5 stars, with no further confirmation

#### Scenario: Change or clear
- **WHEN** a member drags to the fifth star, or taps Clear
- **THEN** their rating becomes 5 stars, or not rated, respectively

#### Scenario: Keyboard
- **WHEN** a member focuses their rating and presses the right arrow at 3 stars
- **THEN** it becomes 3.5 stars

#### Scenario: Older device
- **WHEN** one member's phone has not updated yet
- **THEN** it keeps syncing everything else, and shows the stars once it updates

## MODIFIED Requirements

### Requirement: Optional short review
Each member SHALL be able to write one review per title, of at most 1,000 characters, alongside or without a star rating. A review that is empty after trimming SHALL count as no review.

#### Scenario: Review too long
- **WHEN** a member enters a review longer than 1,000 characters
- **THEN** the system does not save it and shows the limit

#### Scenario: Review without stars
- **WHEN** a member writes a review but gives no stars
- **THEN** the review is saved, and their rating stays empty

### Requirement: Members edit only their own rating
A device SHALL write stars and reviews only as the member it is set up as. The system SHALL reject any local attempt to change another member's stars or review.

#### Scenario: Partner's rating is read-only
- **WHEN** a member opens a title the partner has reviewed
- **THEN** the partner's stars and review are shown, and cannot be edited from this device

### Requirement: Independent ratings never conflict
Both members SHALL be able to rate the same title at the same time, online or offline, and every device SHALL keep both ratings without one overwriting the other.

#### Scenario: Both rate offline
- **WHEN** both members rate the same film while offline, one 4.5 stars and the other 2
- **THEN** after sync both devices show both ratings

#### Scenario: Same member on two devices
- **WHEN** one member rates a title 4 stars on the phone, then 3 on the laptop, while both are offline
- **THEN** after sync both devices show whichever was chosen last

### Requirement: Both members' ratings visible
A title's screen SHALL show both members' stars and reviews, labelled with each member's name, directly under the title's header and before any status controls. A missing rating SHALL show as not rated. List rows SHALL show each member's stars; list rows and grid tiles SHALL show a small mark when either member has written a review, with an accessible label naming who.

#### Scenario: Both shown
- **WHEN** a member opens a title both have rated
- **THEN** the screen shows each member's name with their stars and review, before the Lists block

#### Scenario: Stars in the list
- **WHEN** a member rated a title 4.5 stars and the partner has not rated it
- **THEN** its row shows 4.5 for the member and "not rated" for the partner

#### Scenario: Review hint in the list
- **WHEN** the partner has written a review for a title
- **THEN** that title's row (or tile) shows the review mark, labelled "Reviewed by <partner>"

## REMOVED Requirements

### Requirement: One verdict per member per title
**Reason**: Replaced by star ratings.
**Migration**: Old verdicts stay stored but are not shown; members re-rate with stars.

### Requirement: Filter by verdicts
**Reason**: The members asked to drop score-based filters.
**Migration**: None; search remains.
