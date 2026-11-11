# Spec Delta

## Purpose

Lets two people share one cinefilo catalog across all their devices through end-to-end-encrypted sync, with each device knowing which member it acts for, and lets either person take their data out.

## ADDED Requirements

### Requirement: Local-first operation
Every read and write in cinefilo SHALL complete on the device with no network round trip, and SHALL work in airplane mode. A sync failure SHALL never block use or lose local data; failed syncs SHALL be retried.

#### Scenario: Use with sync down
- **WHEN** the relay is unreachable and a member adds, rates and marks titles
- **THEN** every change is saved and shown locally, and is pushed once the relay is reachable

### Requirement: Create a shared space
The first device SHALL be able to create a shared space. Creating it SHALL also create the first member, named by the person setting it up, and set this device up as that member.

#### Scenario: First setup
- **WHEN** a person opens cinefilo for the first time, chooses "Start a shared list", and enters the name "Andrés"
- **THEN** a space is created with member Andrés, and this device acts as Andrés

### Requirement: Invite by code or QR
A device in a space SHALL be able to show the space's sync code, as text and as a QR code. Another device SHALL join the space by scanning or pasting it, and then receive the full catalog.

#### Scenario: Partner joins
- **WHEN** the partner scans the code on their phone and the phone is online
- **THEN** the phone downloads and shows every title, status and rating in the space

#### Scenario: Invalid code
- **WHEN** a pasted code is malformed or fails its checksum
- **THEN** the system rejects it and changes no local data

### Requirement: Choose who I am on each device
After joining, a device SHALL ask which member it acts for. The choices are each existing member, or "I'm new" with a name, which creates a new member. The choice SHALL be stored only on that device, and changing it later SHALL be possible from Settings.

#### Scenario: Partner creates their member
- **WHEN** the partner joins, chooses "I'm new" and enters "Lucía"
- **THEN** member Lucía is created, this device acts as Lucía, and Andrés's devices list Lucía after sync

#### Scenario: Second device of the same person
- **WHEN** Andrés joins from his laptop and picks "Andrés"
- **THEN** the laptop writes ratings as Andrés, and they merge with his phone's ratings

#### Scenario: Both create a member offline
- **WHEN** two new devices each create a member offline, with different names
- **THEN** after sync both members exist on every device

### Requirement: Rename a member
Any device SHALL be able to rename any member. The new name SHALL show on every device after sync.

#### Scenario: Rename
- **WHEN** a member renames "Lucía" to "Lu"
- **THEN** both members' devices label Lu's ratings as "Lu" after sync

### Requirement: Members are trusted, not authenticated
The system SHALL treat anyone holding the space's sync code as a full participant. It SHALL say in Settings that anyone with the code can read the list and act as either member, and that the only way to revoke access is to start a new space.

#### Scenario: Disclosure shown
- **WHEN** a member opens Settings → Sharing
- **THEN** the screen explains that the code grants full access, and that revoking access means starting a new space

### Requirement: Leave or start over
A device SHALL be able to leave the space. Leaving stops sync and erases cinefilo's local data on that device, after the person confirms, with an offer to export first. A member SHALL be able to start a new space, carrying the current catalog into it. The old space SHALL NOT merge back into the new one.

#### Scenario: Leave
- **WHEN** a member chooses Leave on a device and confirms
- **THEN** that device's cinefilo data and sync code are erased, and other devices are unaffected

#### Scenario: Revoke by new space
- **WHEN** a member starts a new space and shares the new code only with chosen devices
- **THEN** devices still holding the old code no longer receive any new changes

### Requirement: End-to-end-encrypted sync
Everything sent to the relay SHALL be encrypted with a key derived from the sync code, and only devices in the space hold that key. The relay SHALL NOT be able to read titles, names, dates, verdicts or reviews. Cinefilo's space SHALL be separate from any lector space and SHALL NOT share keys or data with it.

#### Scenario: Relay sees ciphertext
- **WHEN** a device pushes a rating
- **THEN** the relay stores only an opaque encrypted batch, with no readable domain data

#### Scenario: Devices converge
- **WHEN** any set of devices in a space receive the same changes in any order, with duplicates
- **THEN** they reach the same titles, statuses, members and ratings

### Requirement: Export and import
A member SHALL be able to export the whole space as a versioned `cinefilo/v1` JSON file. The file holds every title, status, member, rating and removal. Importing such a file SHALL merge by id, SHALL be idempotent, and SHALL either apply completely or change nothing. A file of an unknown version SHALL be rejected.

#### Scenario: Round trip
- **WHEN** a member exports and then imports the file into an empty space
- **THEN** the resulting catalog equals the original, including removed titles and both members' ratings

#### Scenario: Unknown version
- **WHEN** a member imports a file marked `cinefilo/v2`
- **THEN** the system rejects it and changes no data
