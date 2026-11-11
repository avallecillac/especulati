# cinefilo-import Specification

## Purpose
TBD - created by archiving change import-keep-lists. Update Purpose after archive.

## Requirements

### Requirement: Import a titles list
Settings SHALL offer "Import list", which reads a `cinefilo-titles/v1` file of titles, each with a kind, a name, a status (later, watching or watched) and optionally a TMDB id and a year. Each new title SHALL be added as the current member, through the same rules as adding by hand.

#### Scenario: Import new titles
- **WHEN** a member imports a file with 250 titles, none of them in the list
- **THEN** all 250 are added with their statuses, and the partner receives them after sync

### Requirement: Preview before importing
Before anything is written, the app SHALL show how many titles are new, how many are already in the list and how many lines are invalid, and SHALL import only after the member confirms.

#### Scenario: Cancel the preview
- **WHEN** a member opens the preview and cancels
- **THEN** nothing is added

### Requirement: All or nothing, and idempotent
An import SHALL apply every new title in one transaction or none of them. A title already in the list (same derived id) SHALL be left as it is. Importing the same file again SHALL add nothing.

#### Scenario: Import twice
- **WHEN** a member imports the same file a second time
- **THEN** the preview shows 0 new titles and nothing changes

#### Scenario: Invalid file
- **WHEN** the file has the wrong version or is not valid JSON
- **THEN** the app says why and adds nothing

### Requirement: Imported details
A title with a TMDB id SHALL get the same id as if added from TMDB search, so the partner adding the same film later finds it already there. Its details and poster SHALL be fetched later in the background when a TMDB key is set, never blocking the import.

#### Scenario: Same id as a search add
- **WHEN** an imported title has TMDB id 27205 as a movie
- **THEN** its id equals the id a TMDB search add of that film produces

### Requirement: Import a watch order
A titles file entry MAY carry a watch order. Importing SHALL set it on the matching title when that title has no watch order yet, including titles already in the list, and SHALL never change an existing one. The preview SHALL count titles whose order will be set.

#### Scenario: Number an existing history
- **WHEN** a member imports a file whose 263 watched entries carry orders 1–263, 262 of them already in the list without an order
- **THEN** the preview shows 1 new title and 262 orders to set, and after importing the history is numbered 1–263

#### Scenario: Re-import
- **WHEN** the same file is imported again
- **THEN** nothing changes
