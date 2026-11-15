## ADDED Requirements

### Requirement: See and remove duplicate members
Settings SHALL show each member's activity (ratings, reviews, personal-list titles, recommendations, titles added) and which member this device is. A member other than this device's SHALL be removable after a confirmation that names their activity. Removing SHALL hide the member and their data on every device without deleting any row. A device whose member is removed SHALL ask "Who are you?" again.

#### Scenario: Tell the duplicates apart
- **WHEN** two members are both called Vivi
- **THEN** Settings shows each one's counts, so the one with the ratings and lists can be told from the empty one

#### Scenario: Remove the empty one
- **WHEN** a member removes the Vivi with no activity and confirms
- **THEN** that Vivi disappears from both phones, and the other Vivi keeps all her data

#### Scenario: Not this device
- **WHEN** a member looks at their own entry in Settings
- **THEN** there is no Remove button for it

#### Scenario: Removed from the other phone
- **WHEN** the Vivi a phone acts as is removed on the other phone
- **THEN** after sync that phone asks "Who are you?", listing the remaining members

### Requirement: Avoid creating a duplicate member
"Who are you?" after joining SHALL wait for the first sync before offering to create a new member, and creating a name that matches an existing member SHALL first ask whether that member is you.

#### Scenario: Same name
- **WHEN** a member types "vivi" and taps Create me while a Vivi exists
- **THEN** the app asks "There is already a Vivi. Is that you?" before creating anything
