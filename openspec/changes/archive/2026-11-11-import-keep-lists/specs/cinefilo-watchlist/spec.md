## MODIFIED Requirements

### Requirement: Mark as watched with a date
Marking a title as watched in the app SHALL record a watched date, which is the calendar day on the marking device. The date defaults to today, and "Yesterday" or any earlier day is available. A title SHALL keep at most one watched date; marking it watched again replaces the date. A title MAY be watched with no date when the date is unknown (for example, imported history), and a member SHALL be able to add a date later.

#### Scenario: Mark watched today
- **WHEN** a member marks a movie watched with the default date
- **THEN** its watched date is today's date in the device's timezone

#### Scenario: Backdate
- **WHEN** a member marks a movie watched and picks a date three days earlier
- **THEN** its watched date is that earlier day

#### Scenario: Back to later clears nothing it shouldn't
- **WHEN** a watched title is moved back to Watch later
- **THEN** its watched date is cleared, and both members' verdicts and reviews remain

#### Scenario: Watched with no date
- **WHEN** an imported title is watched with no date
- **THEN** its screen shows "Watched · date unknown" with "Add date", and adding a date keeps it watched
