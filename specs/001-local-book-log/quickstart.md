# Quickstart & Validation: Local Book Log (001)

## Prerequisites

- Node 22, and pnpm 10 (`corepack enable`).
- Chromium, for e2e tests. The dev container has Playwright's Chromium preinstalled
  (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), so don't run `playwright install`.

## Setup and automated checks

```bash
pnpm install
pnpm -r typecheck          # includes core's no-DOM lib check
pnpm lint                  # ESLint + dependency-cruiser boundary rule
pnpm test                  # Vitest: packages/core + packages/db (Node, in-memory SQLite-WASM)
pnpm --filter pwa build
pnpm e2e                   # Playwright against `vite preview` of the production build
```

Expected: every command exits 0.

## Scenarios

For the command set, see [contracts/commands.md](contracts/commands.md). For the
worker API, see [contracts/worker-api.md](contracts/worker-api.md).

| # | Scenario | Covers | How |
|---|---|---|---|
| 1 | Add a book with only a title | US2 · 1 | e2e `add-book.spec.ts` |
| 2 | Add with **Start reading now**: the book becomes the home card | US2 · 2, FR-008 | e2e |
| 3 | Blank title and 0 pages are rejected inline, and nothing is stored | US2 · 3–4, SC-006 | core unit tests + e2e |
| 4 | The log sheet is pre-filled with the last page; save 145 and the card updates | US1 · 1–3 | e2e `log-progress.spec.ts` |
| 5 | **Read today** saves a page-less entry | US1 · 4 | e2e |
| 6 | **Yesterday** saves yesterday's date. The clock is mocked to 00:05 | US1 · 5, midnight edge case | e2e using `page.clock` |
| 7 | Saving the last page prompts "Mark as finished?" | US1 · 6 | e2e |
| 8 | Offline: load once, `setOffline(true)`, reload, run scenarios 2–7 | US5 · 1, SC-003 | e2e `offline.spec.ts` |
| 9 | Persistence: add data, close the context, reopen, and the data is present | US5 · 2 | e2e |
| 10 | Undo a toast, remove an old entry, and status and last page recompute | US4 | e2e + core property tests |
| 11 | Library groups books and moves them on Start/Abandon/re-read | US3 | e2e `library.spec.ts` |
| 12 | Two tabs: write in A, focus B, and B shows the write | two-tab edge case | e2e |
| 13 | Rebuilding the DB from `change_log` gives an identical logical dump | FR-011 | db unit test |
| 14 | A failure injected mid-transaction leaves no partial state | FR-010 | db unit test |

## Manual check on iPhone (Safari, iOS 17+)

1. Serve the build over HTTPS with `pnpm --filter pwa preview --host`, through a
   tunnel or on the LAN with a trusted certificate. Or deploy a preview to
   Cloudflare Pages.
2. In Safari, tap Share → **Add to Home Screen**, then open the app from the icon.
   It should open full-screen.
3. Add a book with **Start reading now**, then log a page.
4. Turn on airplane mode, force-quit the app, and reopen it. The app should load and
   the data should be there.
5. Log **Read today** and **Yesterday** entries while still offline.
6. Open Settings. It should show "Storage: persistent" (or the notice that it isn't).

The feature is complete when all of the above pass.

## Validation results (2026-09-27, dev container, Chromium 141 headless)

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` (boundary rules) | ✅ 0 errors, 0 dependency violations |
| `pnpm test` | ✅ 98 tests in 15 files, including 1,000 randomized sequences and the change-log replay |
| `pnpm e2e` (scenarios 1–12, time zone change, perf) | ✅ 23/23; 46/46 when repeated twice in parallel |
| SC-002 save → visible | ✅ about 30–50 ms in the e2e test (WAL, research R12) |
| Cold start → Home card (production build) | ✅ about 130 ms (budget 1.5 s) |
| Queries at 100 books / 5,000 events (Node, same engine) | ✅ home ≈ 42–54 ms, library ≈ 42 ms, book ≈ 1 ms |
| Manual iPhone check (above) | ⏳ Pending: needs a device and an HTTPS host |
