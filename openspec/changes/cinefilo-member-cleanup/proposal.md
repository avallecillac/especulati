## Why

The shared list has two members named Vivi. Most likely one phone reached "Who are you?" before the existing members had synced, and created Vivi again. Nobody can tell from the app which Vivi holds the ratings, reviews and personal lists. `RemoveMember` exists in core (a tombstone meant for duplicates), but nothing in the app exposes it. Data is only on the phones and end-to-end encrypted on the relay, so the app has to show this itself.

## What Changes

- **Activity per member:** Settings → Members shows, for each member, how many ratings, reviews, personal-list titles and recommendations they have, and which member this device is.
- **Remove a duplicate:** each member other than this device's has a Remove button. It asks for confirmation, and warns when the member has activity ("Vivi has 12 ratings… they will be hidden"). Removing is a tombstone; nothing is deleted.
- **Device on a removed member:** a device whose member was removed (from the other phone) goes back to "Who are you?".
- **Avoid new duplicates:** "Who are you?" waits for the first sync after joining before offering "I'm new", and creating a name that already exists asks "There is already a Vivi. Is that you?" first.

Out of scope: moving one member's data onto another (merge), restoring a removed member from the UI. No storage, sync or schema change; no Lector code or identifier is touched.

## Capabilities

### Modified Capabilities
- `cinefilo-sharing`: choosing who I am, and removing a duplicate member.

## Impact

`cinefilo-db` (a `memberActivity` read model; `me()` treats a removed member as none), the worker protocol and `dbClient`, `Settings.svelte`, `Welcome.svelte`, e2e specs.
