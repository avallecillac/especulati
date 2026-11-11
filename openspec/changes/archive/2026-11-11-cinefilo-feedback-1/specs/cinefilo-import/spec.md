## ADDED Requirements

### Requirement: Import a watch order
A titles file entry MAY carry a watch order. Importing SHALL set it on the matching title when that title has no watch order yet, including titles already in the list, and SHALL never change an existing one. The preview SHALL count titles whose order will be set.

#### Scenario: Number an existing history
- **WHEN** a member imports a file whose 263 watched entries carry orders 1–263, 262 of them already in the list without an order
- **THEN** the preview shows 1 new title and 262 orders to set, and after importing the history is numbered 1–263

#### Scenario: Re-import
- **WHEN** the same file is imported again
- **THEN** nothing changes
