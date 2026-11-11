## ADDED Requirements

### Requirement: Shared watch order
Titles watched on the Together list SHALL have a place in a shared watch history, numbered from #1 (the first watched together). Marking a title watched on Together SHALL put it after every title already in the history. Both devices SHALL show the same numbers.

#### Scenario: Next number
- **WHEN** the history has 263 titles and a member marks another title watched on Together
- **THEN** it is #264 on both devices after sync

#### Scenario: Concurrent marks converge
- **WHEN** both members mark different titles watched on Together while offline
- **THEN** after sync both devices show the same numbering for both titles

#### Scenario: Leaving Watched
- **WHEN** a title moves from Watched back to Watch later on Together
- **THEN** it leaves the history and the titles after it move up by one

### Requirement: Order of the Watched list
The Together Watched list SHALL show each title's number and list newest first by default. A per-device toggle SHALL list from #1 instead. Titles watched with no history place SHALL come after numbered ones.

#### Scenario: From the first
- **WHEN** a member switches the Watched list to "From #1"
- **THEN** the first row is #1 and the choice is remembered on that device
