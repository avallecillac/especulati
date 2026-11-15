## Decisions

### D1. `memberActivity()` read model
Per live member: `ratings` (rows with stars), `reviews` (rows with a review), `personal` (live `member_status` rows with a status), `recommendations` (sent or received, not deleted), `titlesAdded` (live titles with `added_by` = member). Live = row and its title not deleted or merged. Returned with `MemberView` fields; `total` = sum. Exposed through the worker protocol like `members()`.

### D2. Settings → Members
Each member card: name, "(this device)" when it is, and one muted line "12 ratings · 3 reviews · 40 on their list · 2 recommendations · 15 added" (zero counts omitted; "No activity yet" when all are zero). Rename stays. Members other than this device get a `Remove <name>` button (danger style). Confirm with the app's existing confirm pattern (a sheet or inline confirm, as Settings already does for destructive steps): "Remove Vivi? Their ratings, reviews and lists will be hidden on both phones." — with the counts when `total > 0`, "They have no activity." otherwise. Confirm sends `RemoveMember`; toast "Removed Vivi." (no undo).

### D3. A device whose member is removed
`me()` returns `memberId: null` when `meta.member_id` points at a tombstoned member, so the app shows "Who are you?" (existing onboarding step), listing live members only.

### D4. Fewer duplicates
- After a successful join, "Who are you?" shows "Getting the members…" until the first sync pull completes (or fails/times out after 15 s); then the member buttons and "I'm new".
- "Create me" with a name that matches a live member (trimmed, case- and accent-insensitive) shows "There is already a <name>. Is that you?" with "Yes, I'm <name>" (picks that member) and "No, create a new one".
