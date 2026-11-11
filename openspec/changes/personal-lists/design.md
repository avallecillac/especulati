## Context

Cinéfilo today: one catalog (`titles`) whose status, watched date and season are shared and edited by both members (LWW per field), plus `ratings` that are single-writer per member. Members are trusted, not authenticated (`cinefilo-sharing`). Old app versions in the field reject a whole pushed batch that names an unknown table and move past it; Lector solved this with batch tiers and a cursor reset after upgrade (Lector 007/008). The same shared engine, `tierOf` and `runMigrations` are used here.

## Goals / Non-Goals

**Goals:** personal lists without duplicating titles; zero write conflicts on personal data; obvious "whose list"; recommendations; safe rollout to devices on the old version.

**Non-Goals:** privacy controls, notifications, per-list stats, changing the Together list's behaviour.

## Decisions

### D1. Data model (migration 2)
```sql
CREATE TABLE member_status (
  id TEXT PRIMARY KEY,               -- uuidFromHash('cinefilo-mstatus-v1|<title_id>|<member_id>')
  title_id TEXT NOT NULL, member_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('later','watching','watched')),   -- NULL = not on my list
  watched_on TEXT, current_season INTEGER,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,               -- uuidFromHash('cinefilo-rec-v1|<title_id>|<from>|<to>')
  title_id TEXT NOT NULL, from_member TEXT NOT NULL, to_member TEXT NOT NULL,
  created_at TEXT NOT NULL,
  withdrawn_at TEXT,                 -- written only by from_member
  answered TEXT CHECK (answered IN ('accepted','dismissed')), answered_at TEXT,   -- written only by to_member
  deleted_at TEXT);
```
Partial indexes on `(member_id, status) WHERE deleted_at IS NULL` and `(to_member) WHERE answered IS NULL AND withdrawn_at IS NULL`. Derived ids make concurrent creation of the same row converge (same pattern as ratings). New frozen labels `cinefilo-mstatus-v1`, `cinefilo-rec-v1`, guarded.

### D2. Single writer, enforced in `decide()`
Commands: `SetMyStatus{titleId, status|null, watchedOn?}`, `SetMySeason{titleId, season}`, `Recommend{titleId}`, `WithdrawRecommendation{id}`, `AnswerRecommendation{id, answer}`. `decide()` rejects any write to another member's `member_status` (`NotYourList`), a `Recommend` to oneself, a withdraw by anyone but `from_member`, and an answer by anyone but `to_member` (`NotYours`). Accepting writes the recommendation answer AND `SetMyStatus(later)` in one decision (unless the member already has a status). Fields of a recommendation have a single writer each, so LWW never mixes writers. `watched` personal status may have no date (same rule as Together, optional).

### D3. Adding "Just me"
`AddTitle` gains `to: 'together' | 'me'`. For `me`, the title row is created (or found, same derived id) **without a Together status** (`status = NULL`, a new allowed value meaning "not on Together"), and a `member_status` row is set. Together list queries exclude `status IS NULL`. Existing rows all have a status, so nothing changes for them. Reconcile (D4 of add-cinefilo) also merges `member_status` and `recommendations` rows onto the survivor, per field by HLC, with derived ids rebuilt for the survivor.

### D4. Batch tier and rollout
`tierOf` returns `'p'` for `member_status`, `recommendations`, and for any `titles` op that writes `status: null`. Old devices skip only those batches. Migration 2 resets `sync_cursor` once so an updated device re-reads the space (ops it has are ignored by id). Tested with a convergence scenario: an old-version peer that skips tier `p`, then upgrades and converges.

### D5. UI
- **Switch:** a segmented control above the tabs, `Together · <my name> · <partner name>`, default Together on every app open (state kept while the app is open). `aria-label="List"`; each option is a radio.
- **Whose list:** the header reads "Together", "Your list" or "<Partner>'s list · view only". The partner's list uses the theme's "other" treatment: a token `--other-accent` (Béton: outlined rust frame; Willis: smoke) and no edit controls; tapping a title opens the title screen with only "my status" editable.
- **Tabs:** unchanged (Watch later / Watching / Watched), filtered by the list's statuses. Recommendations pending for me appear at the top of my Watch later, marked "Recommended by <name>", with Accept and Dismiss.
- **Title screen:** a "Lists" block with three rows: Together (editable as today), You (status control + season + date), <Partner> (read-only text). "Recommend to <partner>" appears when the partner has no status for it and there is no open recommendation; after sending: "Recommended · Withdraw".
- **Add sheet:** "Add to: Together / Just me", default = the list on screen (Together when the partner's list is on screen).
- Tokens only; the colour guard and contrast tests cover the new token in both themes.

### D6. Export
`cinefilo/v1` export gains `memberStatus` and `recommendations` arrays (optional on import, so older exports still import). Lossless round trip tested.

## Risks / Trade-offs

- **A device still on the old version shows titles added "Just me" without status** → those `titles` ops are tier `p`, so the old device never sees them until it updates.
- **Members are trusted** → a modified client could write the partner's list; same accepted risk as ratings (`cinefilo-sharing`).
- **Preview builds share the production D1** → pairing a preview with the real space writes real (encrypted) ops. The preview is for viewing with a fresh test space; tasks say so.
