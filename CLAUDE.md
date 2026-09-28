# Readerlog

A local-first reading log: a PWA (SQLite-WASM on OPFS) plus, later, a Chrome extension and an
end-to-end-encrypted sync relay. Read `docs/architecture.md` and
`.specify/memory/constitution.md` before changing anything. The constitution wins over this
file.

## Commands

```bash
pnpm install
pnpm typecheck        # all packages; packages/core has no DOM lib (purity check)
pnpm lint             # ESLint + dependency-cruiser boundary rules
pnpm test             # Vitest: packages/core + packages/db (Node, in-memory SQLite-WASM)
pnpm e2e              # Playwright on Chromium against the production build
pnpm --filter pwa dev # local dev server
```

## Layout and rules

- `packages/core`: **pure**. No DOM, SQLite, `fetch`, `Date.now`, `Math.random`, or
  `crypto.randomUUID`, and no imports from other packages. Every write goes through
  `decide(snapshot, command, now) → Result<Decision, Rejection>`. IDs and dates come in
  inside the command.
- `packages/db`: SQLite schema and migrations, `applyChanges` (rows + `field_clock` +
  `change_log` in one transaction), and the read models. It runs in the browser worker and
  in Node tests.
- `apps/pwa`: Svelte 5 UI. The UI never touches SQLite directly; it talks to
  `src/worker/db.worker.ts` through `src/lib/dbClient.ts`
  (`specs/001-local-book-log/contracts/worker-api.md`).
- Book status and the last page are **derived** from events, never stored. Removing
  anything sets `deleted_at` (a tombstone); rows are never deleted.
- `local_date` is always explicit and computed in the shell (`apps/pwa/src/lib/clock.ts`).
- The DB runs in WAL mode with EXCLUSIVE locking (research R12). Tabs take turns on the DB
  through the Web Lock `readerlog-db`.

## Workflow (spec-kit)

`/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-analyze` → `/speckit-implement`. There is one folder per feature in `specs/NNN-*`,
and every plan includes a Constitution Check.

Write tests first: core with no mocks, db against in-memory SQLite, and user flows in
Playwright.

## Model roles

The main session runs on **Opus** and acts as architect and reviewer. Implementation goes
to **Sonnet** subagents: the Agent tool with `model: "sonnet"`, which is currently Sonnet 5.

**Opus (main session) owns:**

- spec-kit design steps: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`,
  `/speckit-tasks`, `/speckit-analyze`, and constitution amendments;
- architecture and complex decisions: contracts, schema and migrations, sync and merge
  semantics, security and privacy, and trade-offs such as research R12;
- reviewing every Sonnet result before it is committed: read the diff, check it against
  the spec, contracts, and constitution, and run the checks;
- root-causing failures that a Sonnet agent could not fix in one retry.

**Sonnet subagents own implementation.** During `/speckit-implement`, delegate each
task, or a batch of `[P]` tasks that touch different files, to a Sonnet agent. Run
parallel `[P]` batches concurrently. Each agent prompt must be self-contained:

- the task IDs and text from `tasks.md`, copied verbatim;
- the paths of the spec, contracts, and data-model sections that apply;
- the rules in this file, especially the `packages/core` purity rules;
- tests first: write the test, confirm it fails, then implement;
- done means `pnpm typecheck`, `pnpm lint`, and the relevant `pnpm test` / `pnpm e2e`
  pass, and the agent reports the commands it ran and their output;
- agents must not commit or push, and must not edit `specs/`, `.specify/`, or this file.

**After each phase:**

1. Opus reviews the combined diff and re-runs all checks.
2. Opus marks the tasks `[X]` and commits. Only the main session commits.

**Escalation:** if a Sonnet agent reports a design gap, a contract conflict, or a
failure it can't explain, stop delegating that task. Opus decides the fix and updates
the spec or contracts first when the decision changes them. Then either fix it directly
or re-delegate it with the decision included.

## Pinned versions

- **TypeScript 5.9**: typescript-eslint does not support TypeScript 7 yet.
- **Playwright 1.56.1**: matches the Chromium preinstalled in the cloud dev container. Don't
  run `playwright install` there.
- **`@sqlite.org/sqlite-wasm` 3.53.4-build1**: the same engine in the browser and in tests.
