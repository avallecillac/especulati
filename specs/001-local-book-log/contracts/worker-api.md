# Contract: UI ↔ DB worker API (apps/pwa)

The UI never touches SQLite directly. It talks to `db.worker.ts` through a typed
request/response wrapper over `postMessage`. Each request carries a correlation `id`.

```ts
type Request =
  | { id: number; kind: 'dispatch'; cmd: Command }
  | { id: number; kind: 'query'; q: Query };

type Query =
  | { name: 'home' }                       // current book card + other reading books
  | { name: 'library' }                    // books grouped by derived status
  | { name: 'book'; itemId: ItemId }       // item + non-deleted events (newest first) + status + lastPage
  | { name: 'storage' };                   // { persisted: boolean, deviceId, schemaVersion }

type Response =
  | { id: number; ok: true;  result: unknown }        // typed per query/command in code
  | { id: number; ok: false; error: Rejection | { kind: 'Storage'; message: string } | { kind: 'Busy' } };
```

## Read models

```ts
interface BookCard { itemId; title; author?; totalPages?; status; lastPage?; lastActivity? }
interface HomeView { current: BookCard | null; otherReading: BookCard[]; queuedCount: number }
interface LibraryView { reading: BookCard[]; queued: BookCard[]; finished: BookCard[]; abandoned: BookCard[] }
interface BookView { card: BookCard; genre?; events: { id; type; page?; localDate; occurredAt }[] }
```

## Behavior

- **Dispatch.** A `dispatch` runs the command in one transaction:
  1. load the snapshot;
  2. run `decide`;
  3. apply the changes;
  4. commit.

  It returns `{ offerFinish }`. On commit, it posts `{type:'changed'}` on
  `BroadcastChannel('readerlog')`.
- **Tab ownership.** The worker holds the Web Lock `readerlog-db` while its tab is
  visible.
  - While the tab is hidden, requests are queued until the tab is visible again.
  - If the lock is still unavailable after 5 s, the worker returns `{kind:'Busy'}` and
    the UI shows "Readerlog is open in another window".
- **Storage failures.** A quota or I/O failure during commit returns
  `{kind:'Storage'}`, and the transaction is rolled back (spec edge case).
- **First start.** On first start, the worker:
  - runs the migrations;
  - creates `meta.device_id`;
  - calls `navigator.storage.persist()`;
  - records the result.
