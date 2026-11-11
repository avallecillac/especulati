## MODIFIED Requirements

### Requirement: Posters are optional
A device setting SHALL choose between TMDB posters (the default) and generated covers. Posters SHALL be shown in their original colours in every theme, and a title without a cached poster SHALL fall back to its generated cover.

#### Scenario: Default shows posters
- **WHEN** a member who never changed the setting opens a list with a title that has a cached poster
- **THEN** the poster is shown in its original colours

#### Scenario: Posters on, none cached
- **WHEN** posters are on and a title has no cached poster
- **THEN** its generated cover is shown

#### Scenario: Generated on request
- **WHEN** a member picks Generated in Settings → Covers
- **THEN** every title shows its generated cover on that device, and the choice survives a reload
