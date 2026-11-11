## ADDED Requirements

### Requirement: Two themes and Automatic
The app SHALL offer two themes, Béton (light) and Willis (dark), plus Automatic, which shows Béton when the device is in light mode and Willis when it is in dark mode. Automatic SHALL be the default.

#### Scenario: Automatic follows the device
- **WHEN** appearance is Automatic and the device switches to dark mode
- **THEN** the app shows Willis without a reload

#### Scenario: Fixed choice
- **WHEN** a member picks Béton in Settings → Appearance
- **THEN** the app shows Béton regardless of the device's mode

### Requirement: Appearance is per device
The appearance choice SHALL be stored on the device only. It SHALL NOT be synced, exported or shown to the partner.

#### Scenario: Partners choose independently
- **WHEN** one member picks Willis and the other keeps Automatic
- **THEN** each device keeps its own choice after sync

### Requirement: No flash of the wrong theme
The chosen theme SHALL be applied before the first paint, including the browser's theme colour.

#### Scenario: Reload with a fixed choice
- **WHEN** a member who picked Willis reopens the app in light mode
- **THEN** the first frame already uses Willis

### Requirement: Works offline
Every font a theme uses SHALL be bundled with the app and available offline. The app SHALL make no font request to a third party.

#### Scenario: Offline first open
- **WHEN** the installed app opens with no network
- **THEN** titles and reviews render in the theme's fonts

### Requirement: Generated covers
Every title SHALL have a generated cover derived only from its id, in the current theme's style. The same title SHALL get the same cover on every device.

#### Scenario: Same cover on both phones
- **WHEN** both members look at the same title in the same theme
- **THEN** they see identical generated covers

### Requirement: Posters are optional
A device setting SHALL choose between generated covers (the default) and TMDB posters. Posters SHALL be shown in the theme's treatment, and a title without a poster SHALL fall back to its generated cover.

#### Scenario: Posters on, none cached
- **WHEN** posters are on and a title has no cached poster
- **THEN** its generated cover is shown

### Requirement: Original art only
Theme art and covers SHALL be original. They SHALL NOT reproduce film stills, posters, logos or characters; references to the films are allusions only.

#### Scenario: Review of the art files
- **WHEN** the theme art is reviewed
- **THEN** every drawing is an original composition made for Cinéfilo

### Requirement: Readable in both themes
Text and controls SHALL meet WCAG AA contrast in both themes (4.5:1 for text, 3:1 for large text and control borders), and tap targets SHALL stay at least 44 px.

#### Scenario: Contrast check
- **WHEN** the theme contrast test runs
- **THEN** every listed token pair passes in both themes
