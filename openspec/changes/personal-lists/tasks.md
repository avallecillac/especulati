# Tasks

Checks = `pnpm typecheck`, eslint, depcruise, `pnpm test`, `pnpm test:convergence`, `pnpm --filter cinefilo build`; UI groups also `pnpm e2e`. All work stays on branch `personal-lists`; do not merge to `main`.

## 1. Core

- [x] 1.1 Tests first: `member_status` and `recommendations` in `cinefiloSchema` (writable fields, insert fields, tier `p` per D4), `titles.status` may be NULL; frozen labels `cinefilo-mstatus-v1`, `cinefilo-rec-v1` pinned.
- [x] 1.2 `decide()` for `SetMyStatus`, `SetMySeason`, `Recommend`, `WithdrawRecommendation`, `AnswerRecommendation` with the D2 rejections; `AddTitle` with `to: 'me'` (D3). Tests mirror every scenario in the `cinefilo-personal-lists` spec that core can observe.
- [x] 1.3 Reconcile carries `member_status` and `recommendations` onto the survivor (D3); determinism tests.

## 2. Storage and sync

- [x] 2.1 Migration 2 (tables, indexes, cursor reset) with a migration test from a v1 fixture database.
- [x] 2.2 Read models: lists per scope (together / member) and tab, pending recommendations, title detail with all three statuses; Together excludes `status IS NULL`.
- [x] 2.3 Export/import with the new arrays (D6), round-trip and old-export tests.
- [x] 2.4 Convergence: 2 members on 3 devices with personal edits, recommendations and answers, plus an old-version peer that skips tier `p` and then upgrades (D4). 1,000 runs.

## 3. UI (Playwright first)

- [ ] 3.1 List switch, headers, partner view-only treatment (`--other-accent` token in both themes, contrast-tested), default Together on open.
- [ ] 3.2 Title screen "Lists" block, my status/season/date, recommend and withdraw.
- [ ] 3.3 Pending recommendations on my Watch later with Accept / Dismiss; two-device test against the local relay.
- [ ] 3.4 Add sheet "Add to: Together / Just me" with the default rule.
- [ ] 3.5 Screenshots of each new screen in both themes to `e2e/cinefilo/__screens__/` for the main session's review.

## 4. Preview (no production)

- [ ] 4.1 Push the branch; the Cloudflare preview deploy builds. Check it with a fresh test space only (never the real sync code).
- [ ] 4.2 (User) Review on the preview; merge to `main` only on the user's go-ahead.
