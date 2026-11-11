## MODIFIED Requirements

### Requirement: Both members' ratings visible
A title's screen SHALL show both members' verdicts and reviews side by side, labelled with each member's name, directly under the title's header and before any status controls. A missing rating SHALL show as "not rated yet". List rows and grid tiles SHALL show a small mark when either member has written a review, with an accessible label naming who.

#### Scenario: Side by side
- **WHEN** a member opens a title both have rated
- **THEN** the screen shows each member's name with their verdict and review, before the Lists block

#### Scenario: Review hint in the list
- **WHEN** the partner has written a review for a title
- **THEN** that title's row (or tile) shows the review mark, labelled "Reviewed by <partner>"
