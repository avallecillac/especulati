## ADDED Requirements

### Requirement: Search the list
Every list SHALL have a search field that filters the titles on screen by name as the member types, ignoring case and accents, offline, with a Clear button. Filters and the watch order still apply.

#### Scenario: Find a title
- **WHEN** a member types "godf" in Watched
- **THEN** only titles whose name contains "godf" (for example *The Godfather*) are listed

#### Scenario: Accents
- **WHEN** a member searches "amelie"
- **THEN** *Amélie* is listed

#### Scenario: Nothing matches
- **WHEN** no title matches the query
- **THEN** the list says no titles match it

### Requirement: Compact list header
The list header SHALL fit in three short rows at 390 px: the heading with the layout toggle and Add, the Together/me/partner switch, and a tools row with search, the watch-order icons (Together Watched only) and one Filter button. The verdict filters SHALL be chosen in a Filter sheet, and an active filter SHALL show as a removable chip. The watch order SHALL be two arrow icons named "Newest first" and "From #1".

#### Scenario: Header height
- **WHEN** the Together Watched list opens at 390×844 with no filter on
- **THEN** the first title row starts within the top 220 px of the screen

#### Scenario: Pick a filter
- **WHEN** a member opens Filter and picks "Both liked"
- **THEN** the sheet closes, only titles both members liked are listed, and a "Both liked" chip removes the filter

### Requirement: Keep the place in a list
Going back from a title to the list it was opened from SHALL show that list scrolled to where it was, with the same filter and search. A title SHALL open scrolled to its top.

#### Scenario: Back from a title
- **WHEN** a member scrolls halfway down Watched, opens a title, and taps Back
- **THEN** Watched shows the same titles at the same scroll position
