# Contract: Change log entry (produced in 001, consumed by 004 sync and 006 export)

Each applied `Change` produces exactly one `change_log` row:

| Column | Format | Example |
|---|---|---|
| `op_id` | UUID v4, unique across all devices | `5b0e…` |
| `hlc` | `<13-digit unix ms>-<4-digit counter>-<device uuid>` | `1790000000000-0000-9c1d…` |
| `device_id` | UUID of the originating device | |
| `tbl` | `items` \| `reading_events` (later: `tags`, `item_tags`) | |
| `row_id` | primary key of the row | |
| `fields_json` | JSON object of the fields set by this change | `{"deleted_at":"2026-09-27T10:00:00.000Z"}` |
| `pushed` | 0 until feature 004 acknowledges it | |

## Rules

- **Merge-compatible.** A row can be rebuilt by replaying its entries in HLC order
  and applying last-writer-wins per field. Feature 004 relies on this property. A
  test in 001 rebuilds the database from `change_log` alone into a fresh database
  and compares it with a logical dump.
- **Complete.** An event insert includes all of the event's fields, and an item
  insert includes all non-null fields.
- **Append-only.** Rows are never updated, except the `pushed` flag.
