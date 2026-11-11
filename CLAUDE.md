# especulati

A pnpm monorepo of local-first PWAs (SQLite-WASM on OPFS) with end-to-end-encrypted sync
through a zero-knowledge relay (Cloudflare Pages Functions + D1).

- **Lector** (formerly Readerlog): the single-user reading log, plus a Chrome extension.
  Read `docs/architecture.md` and `.specify/memory/constitution.md` before changing
  anything in Lector. The constitution wins over this file.
- **Cinéfilo**: a shared movies-and-series tracker for two people. Planned in
  `openspec/changes/add-cinefilo/`; not built yet.

## Commands

```bash
pnpm install
pnpm typecheck        # all packages; packages/lector-core has no DOM lib (purity check)
pnpm lint             # ESLint + dependency-cruiser boundary rules
pnpm test             # Vitest: lector-core, lector-db, sync, relay, lector (Node, in-memory SQLite-WASM)
pnpm test:convergence # the full 1,000-run sync convergence test (SC-003; about 2 min)
pnpm e2e              # Playwright on Chromium against the production build
pnpm --filter lector dev # local dev server
pnpm --filter @especulati/lector-extension build      # release extension → apps/lector-extension/dist (fails on host_permissions or test hooks)
pnpm --filter @especulati/lector-extension build:e2e  # test build with localhost access → dist-e2e (e2e only, never ship)
```

## Frozen identifiers (Lector)

Lector's storage and wire identifiers still say `readerlog`, and they MUST NOT change:
the OPFS file and SAH-pool names, the Web Lock, the BroadcastChannel, the HKDF salt, the
envelope AAD, the QR prefix, every derived-id hash label, `readerlog.appearance` and the
`readerlog/v1` export format. Changing one orphans local data or splits the sync space.
They live in `frozen.ts` files and are pinned by `packages/sync/test/frozen-ids.test.ts`
and `apps/lector/src/frozen-ids.test.ts`. Never do a repo-wide replace of `readerlog`.
See `openspec/changes/rename-to-lector/design.md` (D1).

## Layout and rules (Lector)

- `packages/lector-core`: **pure**. No DOM, SQLite, `fetch`, `Date.now`, `Math.random`, or
  `crypto.randomUUID`, and no imports from other packages. Every write goes through
  `decide(snapshot, command, now) → Result<Decision, Rejection>`. IDs and dates come in
  inside the command.
- `packages/lector-db`: SQLite schema and migrations, `applyChanges` (rows + `field_clock` +
  `change_log` in one transaction), and the read models. It runs in the browser worker and
  in Node tests.
- `packages/sync`: the sync code, HKDF keys, AES-GCM envelopes, relay client and engine.
  The engine runs **inside the DB worker**. It must not import `apps/*`; inject `fetch`,
  `now`, `random` and `online`.
- `apps/relay` + `functions/`: the zero-knowledge relay. It stores opaque
  `{ batchId, iv, ct }` only, and must not import `packages/*` (dependency-cruiser
  enforces this). `functions/api/[[path]].ts` is the Pages Functions adapter (D1 binding
  `RELAY_DB`).
- `apps/lector-extension`: the Chrome/Brave MV3 extension. It must not import
  `packages/lector-db` or `apps/lector`. It writes through core `decide()` + `stampOps`, and
  pushes through `packages/sync/src/capturePeer.ts`, which never pulls. The extractor
  returns only `{ url, title, author, words }`; article text is never stored or sent,
  except text the user explicitly saves as a highlight (constitution v1.2.0). Test hooks
  exist only in the `EXT_E2E` build.
- Articles are `items` with `type = 'article'`, and have no events. Book queries and
  stats stay books-only.
- **Remote changes** (merged from other devices) skip `decide()` under the constitution
  v1.1.0 exception: `parseRemoteOp`'s allow-list, then `applyRemoteOps`, all-or-nothing.
  Local writes, including `MergeBooks`, still go through `decide()`.
- Never log, throw or store in errors: the sync code, keys, auth token or plaintext ops.
- `apps/lector`: Svelte 5 UI. The UI never touches SQLite directly; it talks to
  `src/worker/db.worker.ts` through `src/lib/dbClient.ts`
  (`specs/001-local-book-log/contracts/worker-api.md`).
- **Themes (006):** colours, fonts and radii live only in `apps/lector/src/theme/<id>.css`
  as tokens (`contracts/theme-tokens.md` in 006). Screens use tokens; a guard test fails
  on literal colours. Ornaments in `src/ornaments/` are original SVG art, `aria-hidden`.
  Custom e2e contexts need `contextOptions: { reducedMotion: 'reduce' }`, and
  `--repeat-each` must be passed to `npx playwright test` in `e2e/`, because
  `pnpm e2e --` drops it.
- **Highlights (007):**
  - The `highlights` table stores only the user's explicit selection (`normalizeQuote`)
    and their note, each at most 5,000 characters.
  - Commands go through `decide()`.
  - Pushed batches are single-tier: `tierOf` keeps `highlights` ops apart, so devices
    on an older version never lose base ops. Give any future table its own tier.
- **Saved articles and tags (008):**
  - A saved article is `type = 'article' AND read_on IS NULL`. Read-article lists and
    stats must exclude it.
  - A saved insert emits `read_on: null` **explicitly** (the `s` tier).
  - `MarkArticleRead` and reconcile carry the full row.
  - Tags are articles only, with ids derived in the shell (`resolveTagId`), never in
    core.
  - Never pass Svelte `$state` proxies to the worker; copy them first.
- Book status and the last page are **derived** from events, never stored. Removing
  anything sets `deleted_at` (a tombstone); rows are never deleted.
- `local_date` is always explicit and computed in the shell (`apps/lector/src/lib/clock.ts`).
- **Svelte 5 gotcha (hit three times):** `{@const x = someState}` is a *derived* value.
  Inside an event handler, read everything you need from `x` **before** clearing
  `someState`; after `someState = null`, `x` is null too. Example:
  `onconfirm={() => { const id = x.id; someState = null; doIt(id); }}`.
- The DB runs in WAL mode with EXCLUSIVE locking (research R12). Tabs take turns on the DB
  through the Web Lock `readerlog-db` (frozen name).

## Workflow (OpenSpec)

`/openspec-propose` → review → `/openspec-apply-change` → `/openspec-archive-change`.
Each change lives in `openspec/changes/<name>/` (proposal, design, delta specs, tasks);
archiving merges its specs into `openspec/specs/`. Project rules for artifacts are in
`openspec/config.yaml`. A Lector-facing design includes a Constitution Check.
`specs/001–008` are Lector's spec-kit history: read them, don't add to them.

Write tests first: core with no mocks, db against in-memory SQLite, and user flows in
Playwright.

## Model roles

The main session runs on **Opus** and acts as architect and reviewer. Implementation goes
to **Sonnet** subagents through the project agent `.claude/agents/implementer.md`: the Agent
tool with `subagent_type: "implementer"`. That agent's frontmatter pins `model: sonnet`
and leaves out the Agent tool, so it can't delegate further. Its rules (test-first, no
commits, no spec edits, escalate design questions) are built in, so prompts only need to
carry the task-specific context listed below. If the project agent isn't loaded in a
session, use a general-purpose agent with `model: sonnet` and tell it to follow
`implementer.md`.

**Opus (main session) owns:**

- the OpenSpec planning steps: `/openspec-propose`, reviewing and updating change
  artifacts, `/openspec-archive-change`, and constitution amendments;
- architecture and complex decisions: contracts, schema and migrations, sync and merge
  semantics, security and privacy, and trade-offs such as research R12;
- reviewing every Sonnet result before it is committed: read the diff, check it against
  the change's design and specs and the constitution, and run the checks;
- root-causing failures that a Sonnet agent could not fix in one retry.

**Sonnet subagents own implementation.** During `/openspec-apply-change`, delegate each
task group, or independent tasks that touch different files, to a Sonnet agent. Run
independent batches concurrently. Each agent prompt must be self-contained:

- the task IDs and text from the change's `tasks.md`, copied verbatim;
- the paths of the design and spec sections that apply;
- the rules in this file, especially the `packages/lector-core` purity rules and the
  frozen identifiers;
- tests first: write the test, confirm it fails, then implement;
- done means `pnpm typecheck`, `pnpm lint`, and the relevant `pnpm test` / `pnpm e2e`
  pass, and the agent reports the commands it ran and their output;
- agents must not commit or push, and must not edit `openspec/`, `specs/`, `.specify/`, or
  this file.

**After each task group:**

1. Opus reviews the combined diff and re-runs all checks.
2. Opus marks the tasks `[x]` in `tasks.md` and commits. Only the main session commits.

**Escalation:** if a Sonnet agent reports a design gap, a contract conflict, or a
failure it can't explain, stop delegating that task. Opus decides the fix and updates
the change's design or specs first when the decision changes them. Then either fix it
directly or re-delegate it with the decision included.

## Local environment notes

- In the Claude Code sandbox, pnpm fails with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`;
  run pnpm commands outside the sandbox.
- The `rtk` hook rewrites `pnpm lint` so dependency-cruiser doesn't run; run
  `npx eslint .` and `npx depcruise packages apps/lector/src apps/relay/src apps/lector-extension/src --config .dependency-cruiser.cjs`
  directly.
- `pnpm e2e` needs Playwright 1.56.1's pinned Chromium (build 1194). The Mac doesn't have
  it; run e2e in CI or the cloud dev container.

## Pinned versions

- **TypeScript 5.9**: typescript-eslint does not support TypeScript 7 yet.
- **Playwright 1.56.1**: matches the Chromium preinstalled in the cloud dev container. Don't
  run `playwright install` there.
- **`@sqlite.org/sqlite-wasm` 3.53.4-build1**: the same engine in the browser and in tests.
