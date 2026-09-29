# Contract: Relay HTTP API (`/api/v1`)

- **Host.** The relay is served same-origin by Pages Functions (research R1).
- **Handler.** `apps/relay/src/handler.ts`:
  `handle(req: Request, store: RelayStore, now: () => number): Promise<Response>`.
- **Auth.** Every request carries `Authorization: Bearer <authToken>` (research R2).
  The relay looks up `spaces.token_hash` and compares `sha256hex(token)` in constant
  time.
  - A missing or wrong token on an existing space gives **401**.
  - An unknown space gives **404**. `PUT` is the only request that works on an unknown
    space.
- **Bodies and errors.** Bodies are JSON. Every error is `{ error: string }`, with no
  echo of input.

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `PUT /spaces/:id` | none | `201 {}`: creates the space with this token's hash | `409` exists; `400` bad id (not 32 lowercase hex) |
| `GET /spaces/:id` | none | `200 { exists: true }` | `401`, `404` |
| `DELETE /spaces/:id` | none | `204`: the space and all its batches are deleted | `401`, `404` |
| `POST /spaces/:id/batches` | `{ batchId: uuid, iv: b64url(12 bytes), ct: b64url }` | `200 { seq, duplicate: false }`, or `200 { seq, duplicate: true }` for a batch id already stored (same `seq` returned) | `400` malformed; `401`; `404`; `413` over 1 MiB; `429` with `Retry-After` |
| `GET /spaces/:id/batches?after=<int ≥ 0>&limit=<1..100>` | none | `200 { batches: [{ seq, batchId, iv, ct }], more: boolean }`, ascending `seq`, only `seq > after` | `400`, `401`, `404`, `429` |

**Rate limit.** 120 requests per space per minute, counted in `rate` (FR-024). Stale
`rate` rows (older than 10 minutes) are deleted opportunistically.

**Headers.** Every response has `Cache-Control: no-store`.

**Logging.** The relay never logs bodies, tokens or space ids (FR-005).

`RelayStore` interface (adapters: D1 in `functions/`, and SQLite-WASM in tests):

```ts
interface RelayStore {
  getSpace(id: string): Promise<{ tokenHash: string } | null>;
  createSpace(id: string, tokenHash: string, now: number): Promise<boolean>;      // false if exists
  deleteSpace(id: string): Promise<void>;
  appendBatch(id: string, b: { batchId: string; iv: string; ct: string }, now: number): Promise<{ seq: number; duplicate: boolean }>;
  listBatches(id: string, after: number, limit: number): Promise<{ seq: number; batchId: string; iv: string; ct: string }[]>;
  hit(id: string, minute: number): Promise<number>;                                // increments, returns count
  prune(minuteBefore: number): Promise<void>;
}
```

**Tests** (`apps/relay/test/handler.test.ts`, SQLite-WASM store, the same
`schema.sql`):

- every row of the table above;
- idempotent re-POST;
- no cross-space access, even with another space's valid token;
- the rate limit;
- a scan of the stored rows for SC-005: after posting batches of known plaintext
  encrypted by the client, `SELECT *` contains no plaintext substrings.
