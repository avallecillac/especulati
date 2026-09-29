# Contract: Worker messages (004)

These extend `apps/pwa/src/lib/protocol.ts`. The sync engine lives in the DB worker
(research R6), so only the tab that holds the DB syncs.

| Request | Result |
|---|---|
| `{ kind: 'sync'; action: 'run'; reason }` | `SyncRunResult`. If `changed`, the worker broadcasts on `CHANNEL`, and the calling tab refreshes as after a dispatch |
| `{ kind: 'sync'; action: 'status' }` | `SyncStatusView` |
| `{ kind: 'sync'; action: 'turnOn' }` | `{ code, qr }` or `SyncError` |
| `{ kind: 'sync'; action: 'join'; code: string }` | `{ duplicates }` or `SyncError` |
| `{ kind: 'sync'; action: 'showCode' }` | `{ code, qr } \| null` |
| `{ kind: 'sync'; action: 'leave' }` | `null` |
| `{ kind: 'sync'; action: 'reset' }` | `{ code, qr }` or `SyncError` |
| `{ name: 'duplicates' }` (query) | `DuplicatePairView[]`: both books' title, author, ISBN, entry count and `createdAt`, plus the suggested survivor |
| `{ name: 'missingCovers' }` (query) | `{ itemId, coverUrl }[]` for live books with a `cover_url` and no `covers` row (research R12) |

**Main-thread triggers**, in `apps/pwa/src/lib/sync.svelte.ts`:

- `start`: after the DB is ready;
- `visible`: on `visibilitychange`;
- `online`;
- `write`: 3 s after the last successful `dispatch`, debounced;
- `manual`: the top-bar sync button, or **Sync now** in Settings → Sync.
- No background polling in the MVP.

**QR generation and QR scanning run on the main thread**, lazily imported. The sync code
text crosses the worker boundary only for Show code, Turn on, Join and Reset.
