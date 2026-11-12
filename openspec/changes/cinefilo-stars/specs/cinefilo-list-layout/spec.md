## MODIFIED Requirements

### Requirement: Compact list header
The list header SHALL fit in three short rows at 390 px: the heading with the layout toggle and Add, the Together/me/partner switch, and a tools row with search and the watch-order icons (Together Watched only). The watch order SHALL be two arrow icons named "Newest first" and "From #1".

#### Scenario: Header height
- **WHEN** the Together Watched list opens at 390×844
- **THEN** the first title row starts within the top 200 px of the screen

### Requirement: Keep the place in a list
Going back from a title to the list it was opened from SHALL show that list scrolled to where it was, with the same search. A title SHALL open scrolled to its top.

#### Scenario: Back from a title
- **WHEN** a member scrolls halfway down Watched, opens a title, and taps Back
- **THEN** Watched shows the same titles at the same scroll position
