## MODIFIED Requirements

### Requirement: Search the list
Every list SHALL have a search field that filters the titles on screen as the member types, ignoring case and accents, offline, with a Clear button. A title SHALL match by its name, a director, its lead actor or actress, a genre, or a country. The watch order still applies.

#### Scenario: Find a title
- **WHEN** a member types "godf" in Watched
- **THEN** only titles whose name contains "godf" (for example *The Godfather*) are listed

#### Scenario: Find by person
- **WHEN** a member types "coppola"
- **THEN** titles directed by Francis Ford Coppola are listed

#### Scenario: Find by country
- **WHEN** a member types "italy"
- **THEN** titles with Italy among their countries are listed

#### Scenario: Accents
- **WHEN** a member searches "amelie"
- **THEN** *Amélie* is listed

#### Scenario: Nothing matches
- **WHEN** no title matches the query
- **THEN** the list says no titles match it
