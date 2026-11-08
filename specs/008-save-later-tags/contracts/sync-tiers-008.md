# Contract: Sync tiers for 008 (extends 007 contracts/sync-tiers.md)

- **Tiers:** `tierOf(tbl, fields)` returns:
  - `h` for `highlights`;
  - `t` for `tags` and `item_tags`;
  - `s` for an `items` op setting `read_on: null`;
  - `base` otherwise.
- **The rule:** one tier per batch, unchanged. This applies to the DB source
  (`unpushedOps`) and to the extension's capture peer.
- **`MarkArticleRead`** is `base`, and carries the full row (research R2).
- **Migration 5** resets the cursor and the undecryptable counter.
- **Tests:**
  - a push test with mixed tiers;
  - a convergence "0.8.0 peer", which rejects `t` and `s` batches and parks unknown rows.
    It must never hold an article with `read_on NULL`, must keep every `base` op, must
    converge after upgrading, and its read models must not throw at any point.
