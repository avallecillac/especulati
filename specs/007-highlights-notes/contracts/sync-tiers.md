# Contract: Sync batch tiers (forward compatibility, research R2)

- **Tier function:** `tierOf(tbl) = tbl === 'highlights' ? 'h' : 'base'`, in
  `packages/sync/src/push.ts`, and shared.
- **Rule:** every batch from `PushSource.next(limit, upTo?)` contains ops of **one tier
  only**. The batch ends at the first op whose tier differs from the first op's.
  - **DB source:** `unpushedOps` in `packages/db/src/sync.ts`.
  - **Extension source:** the capture peer's `pending` list.
- **Order:** ops keep their `change_log` order. A tier boundary only ends a batch early;
  it never reorders ops.
- **Migration 4:** resets `sync_cursor` to `0` (data-model.md).
- **Tests:**
  - `push.test.ts`: mixed pending ops give single-tier batches, in order;
  - `convergence.test.ts`: a v3 peer that rejects `highlights` batches loses no base
    ops, and converges after it upgrades and re-reads.
