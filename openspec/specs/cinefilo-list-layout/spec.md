# cinefilo-list-layout Specification

## Purpose
TBD - created by archiving change cinefilo-feedback-1. Update Purpose after archive.

## Requirements

### Requirement: List or grid
Every list SHALL offer a list/grid toggle next to the tabs, remembered per device and applied to all lists. The grid SHALL show only posters (the generated cover when there is no poster), three per row at phone width, each tile opening the title and named by its title for screen readers.

#### Scenario: Switch to grid
- **WHEN** a member switches to grid on the Watched list
- **THEN** the titles show as poster tiles, and the other lists also open as grids on that device

#### Scenario: No poster
- **WHEN** a title has no poster
- **THEN** its tile shows the generated cover
