# Quickstart & Validation: Encrypted Sync (004)

## One-time Cloudflare setup (manual)

1. **Create the database.** In the Cloudflare dashboard, go to Storage & Databases → D1
   → **Create**, and name it `readerlog-relay`.
2. **Create the tables.** Open the database's **Console**, paste the contents of
   `apps/relay/schema.sql`, and run it.
3. **Bind it to the site.** In Workers & Pages → your Pages project → Settings →
   Bindings → **Add** → D1 database, set the variable name to `RELAY_DB` and choose
   `readerlog-relay`. Do this for **Production** (and Preview, if you use previews).
4. **Deploy.** Push to `main`. The `functions/` folder deploys with the site.
5. **Check it.** Run
   `curl -s -o /dev/null -w '%{http_code}\n' https://<your-site>/api/v1/spaces/00000000000000000000000000000000 -H 'Authorization: Bearer x'`.
   It should print **404**, which means the space is unknown and the relay is running.

## Automated checks

```bash
pnpm typecheck && pnpm lint
pnpm test   # core: merge/hlcReceive/findDuplicates/MergeBooks; db: migration 3, applyRemoteOps; sync: keys, envelope, engine, convergence ×1000; relay: handler
pnpm e2e    # two browser contexts + routed in-memory relay (research R10)
```

## Scenarios

| # | Scenario | Covers | How |
|---|---|---|---|
| 1 | Turn on: code shown as QR + grouped text, with "save this code" advice | US1 · 1, FR-006 | e2e `sync-pair.spec.ts` |
| 2 | Device B joins with A's code: A's books appear on B within 10 s | US1 · 2, SC-002 | e2e (two contexts) |
| 3 | A typo'd code is rejected locally; an unknown space → "No sync space found"; nothing changes | US1 · 4–5 | sync unit + e2e |
| 4 | Log on A → appears on B without reload | US2 · 1, FR-015 | e2e |
| 5 | A offline logs 3 entries; online → they reach B with original dates | US2 · 2 | e2e (`context.setOffline`) |
| 6 | Title edit on A, pages edit on B → both kept; same field on both → later wins | US2 · 3–4 | convergence + db unit |
| 7 | Remove on A beats an earlier edit on B | US2 · 6 | db unit |
| 8 | Relay unreachable: every flow works; status "Offline…" | US2 · 7, SC-006 | e2e |
| 9 | Status: pending count, last synced, Sync now | US3 | e2e |
| 10 | Space deleted elsewhere → "Rejoin with the new code"; local data kept | US3 · 3, US4 · 3, FR-021 | e2e |
| 11 | Leave → stops syncing, data kept, others unaffected | US4 · 1 | e2e |
| 12 | Reset → new code; old code gets "space gone"; rejoin combines | US4 · 2–4 | e2e |
| 13 | Same book on A and B → "1 possible duplicate" → Merge → one book with all entries, empty fields filled | US5 · 1–2 | e2e + core |
| 14 | Different ISBNs not offered; Keep both never offered again on any device | US5 · 3–4 | core + e2e |
| 15 | Same merge on A and B before syncing → one book, each entry once | US5 · 5, FR-029 | convergence |
| 16 | 2–5 peers, random order and duplicates → identical DBs (1,000 runs) | SC-003 | `convergence.test.ts` |
| 17 | 10,000 changes first sync < 60 s (in-memory relay, Node) | SC-004 | sync perf test |
| 18 | Relay rows contain no plaintext | SC-005, FR-001 | relay test |
| 19 | Covers, Google key, meta never in a batch | FR-004 | sync unit (inspect plaintext of all pushed batches) |
| 20 | Migration v2 → v3 on a fixture DB | constitution | db unit |

## Manual checks (real devices, after the setup above)

1. On the iPhone, go to Settings → Sync → **Turn on sync**. Save the code in your
   password manager.
2. On the Mac, go to Settings → Sync → **Join**, and paste the code. Books from both
   devices appear, and the duplicate prompt lists books you added on both.
3. Merge one pair, and check its entries on both devices.
4. Log a page on the phone, then tap the sync button on the Mac (or bring it to the
   front). The page shows within about 10 s.
5. Put the phone in airplane mode, log two entries, then turn airplane mode off and
   reopen the app. They reach the Mac.

## Validation results

### 2026-09-29, dev container, Chromium 141 headless, version 0.4.0

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | ✅ 0 errors; dependency-cruiser finds no violations. The new rules `relay-is-opaque` and `sync-no-apps` are enforced |
| `pnpm test` | ✅ 436 tests, 54 files, across the core, db, sync, relay and pwa projects |
| `pnpm test:convergence` (SC-003) | ✅ 1,000 seeded runs, 2 to 5 peers with clocks skewed by up to ±1 h, shuffled and duplicated delivery, merges and dismissals, then quiesce: identical dumps every time. A mutation check (every field wins) failed at seed 2 |
| `pnpm e2e` | ✅ 73/73; the sync specs pass **34/34** with `--repeat-each=2` |
| SC-001: join in ≤ 5 steps | ✅ 4 steps, from sync-pair.spec |
| SC-002: seen within 10 s after bringing to the front or tapping Sync now | ✅ sync-flow.spec |
| SC-004: 10k-op first sync < 60 s | ✅ push 0.45 s, join and pull 4.7 s (Node, in-memory relay) |
| SC-005: relay rows hold no plaintext | ✅ privacy.test: title, author, ISBN, page, dates, op, row and device ids are absent raw and base64-encoded; covers, meta and the Google key never enter a batch |
| SC-006: offline and relay down | ✅ sync-flow.spec (503) and sync-status.spec |
| SC-007 / FR-023: free tier | ✅ a simulated day for 3 devices uses 896 requests (0.9%), 2,735 D1 reads (0.05%) and 1,147 D1 writes (1.1%) |
| Scenarios 1–20 | ✅ all automated. Covers for synced books (scenario from FR-016) are covered by the db `missingCovers` test only; there is no e2e for the download path |
| Adversarial review (main session) | Fixed during review: <ul><li>an op's device now comes from its HLC (reset re-push);</li><li>HLC overflow guard;</li><li>merge copy ids made content-addressed (multi-path sweep doubling);</li><li>identical entries collapse instead of blocking a merge;</li><li>per-client rate limit on `PUT /spaces`;</li><li>`sync_old_space` stores the old code, because deleting needs its token</li></ul> |
| Manual device checks (above) | ⏳ Pending: needs the one-time Cloudflare D1 setup, then the iPhone and the Mac |

**Known limits (accepted for the MVP):**
- There is no background polling. An idle open device gets changes when it's brought to
  the front, or when **Sync now** is tapped.
- The relay sees batch sizes and times.
- Two genuinely different entries identical to the millisecond merge into one.
