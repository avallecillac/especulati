## Context

`ratings` rows are single-writer per member (`ratingId` derived from title + member) with per-field LWW: `verdict TEXT CHECK IN ('like','meh','dislike')` and `review`. An older app version's `parseRemoteOp` allow-list refuses any field it does not know, and a refused op fails its whole batch (all-or-nothing), so a new field must ride in its own batch tier — the pattern personal-lists D4 and feedback-1 D3 already use (`tierOf`, then a one-time cursor reset in the next migration).

## Decisions

### D1. Storage: `ratings.stars`, half stars as integers
- Migration 3: `ALTER TABLE ratings ADD COLUMN stars INTEGER CHECK (stars IS NULL OR (stars BETWEEN 1 AND 10))`, then the same one-time cursor reset as migration 2 (`sync_cursor` = 0, `undecryptable` = 0).
- Value = half stars: 1 = 0.5★ … 10 = 5★. Integers avoid float equality and fit the CHECK. Core type `Stars` (branded 1..10) with `parseStars`; UI converts with `stars / 2`.
- `verdict` stays in the schema, the allow-list, the export and reconcile (an old device may still send it). Nothing reads it for display any more, and nothing writes it locally.

### D2. Command
`SetStars { titleId, memberId, ratingId, stars: number | null }` replaces `SetVerdict` in core and in the UI command layer. Same ownership rules (`ownRatingTarget`), same `ratingChange` (insert carries the key). Rejects anything not an integer 1–10 with `InvalidInput`. `SetVerdict` is removed from `Command`; tests that used it move to `SetStars`.

### D3. Sync tier
`tierOf('ratings', fields)` returns `'r'` when `fields` has the `stars` key; everything else is unchanged. The allow-list gains `stars` (integer 1–10 or null; anything else → `ParseError` "unknown stars"). Convergence test: an old-version peer skipping tier `r` keeps converging on everything else, then after migration 3 sees the stars.

### D4. Export and reconcile
- Export rating rows add `stars` (number | null); the parser treats a missing key as null and validates 1–10. `format` stays `cinefilo/v1`.
- Reconcile (merging duplicate titles) carries `stars` like `review`: the loser's value wins only if its field clock is newer.

### D5. Read models
- `ListItem`: `mine` and `partner` become `Stars | null` (half stars), from `ratings.stars`. The review flags stay.
- `RatingView` (title screen): `stars` replaces `verdict`.
- `list(tab, scope)`: the `filter` argument and `filters.ts` (`VERDICT_FILTERS`, `matchesVerdictFilter`, `filterByVerdict`) are removed with their tests.
- A rating row with only an old verdict and no review counts as not rated.

### D6. Star control (title screen)
- `Stars.svelte`, two modes. **Editable:** one `role="slider"` element, `aria-label="Your rating"`, `aria-valuemin=0.5`, `aria-valuemax=5`, `aria-valuenow` (absent when unrated), `aria-valuetext` "3.5 stars" / "Not rated". Five 32 px stars in a row; a tap or drag sets the value from the pointer's x position, rounded up to the next half star (`ceil(x / width * 10)`, clamped 1–10); the whole row is the hit area (no 16 px half targets). Keys: ←/↓ −0.5, →/↑ +0.5, Home 0.5, End 5, Delete/Backspace clear. Writes on pointer up / key, not on every move (the preview follows the pointer). A small "Clear" link button shows next to the number while rated. **Read-only:** the same stars at 16 px, `role="img"`, `aria-label` "<name>: 3.5 stars" / "<name>: not rated".
- Stars are inline SVG, a full star and a half star drawn with a `clipPath`; filled with `--accent` (Willis) / `--ink` (Béton), empty outline in `--ink-soft`. Tokens only, rules in `theme/details.css`.
- Ratings layout: stacked, full width — the "You" block (name, stars + number + Clear, review), then the partner block (name, read-only stars + number, review). The partner's review stays in view at 390×844.

### D7. Lists
- Each row's verdict pair becomes `<initial> ★ 4.5` per member (`aria-hidden` initial and number, one `role="img"` per member with the read-only label "You: 4.5 stars" / "Luz: not rated"); unrated shows `–`. The both-loved mark is removed. Grid tiles are unchanged (no stars on tiles).
- The Filter button, `FilterSheet.svelte`, the active-filter chip and `listView.filter` are removed; `Verdict.svelte`, `VERDICT_LABEL`, `FILTER_LABEL` and the `.vmark` / `.both` CSS go when nothing uses them. Tokens stay (the token contract does not change).

## Risks
- **Old phone, new phone:** until both update, the old phone shows no stars (it skips tier `r`); its verdicts are still written but not shown on the new phone. The update bar makes this short.
- **Dormant verdicts:** kept on purpose (reversible); a later change may drop them.
