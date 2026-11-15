## ADDED Requirements

### Requirement: Country, director and leads from TMDB
For a title linked to TMDB, the system SHALL store its countries, its directors (for a series, its creators), its top-billed actor and its top-billed actress, along with the genres it already stores, and show them on the title's screen. Titles linked before this existed SHALL get them in the background when a TMDB key and a connection are available.

#### Scenario: Add from TMDB
- **WHEN** a member adds a movie from TMDB search
- **THEN** its screen shows its countries, genres, "Directed by …" and "With <actor>, <actress>"

#### Scenario: Already on the list
- **WHEN** the app opens with a TMDB key, online, and titles linked earlier have none of these details
- **THEN** they are filled one by one in the background, and both phones show them after sync

#### Scenario: Missing data
- **WHEN** TMDB lists no actress for a title
- **THEN** the screen shows only the actor, and the title is not fetched again
