# keep-import

Local, one-off tool (never shipped): turns the Google Keep lists in `apps/cinefilo/import.md` into a `cinefilo-titles/v1` file.
Node 22+, no dependencies. Personal files stay in the git-ignored repo-root `import/` and `apps/cinefilo/import.md`.

```bash
node apps/cinefilo/scripts/keep-import/cli.mjs parse   # import.md -> import/parsed.json
node apps/cinefilo/scripts/keep-import/cli.mjs match   # -> import/matches.json, import/review.md, import/cache/
node apps/cinefilo/scripts/keep-import/cli.mjs build   # + import/decisions.json -> import/titles.json
```

Options: `--input <file>` (default `apps/cinefilo/import.md`), `--out <dir>` (default `import/`), `--env <file>` (default `.env`),
`--allow-pending` (build: write the file even when uncertain lines have no decision).

- `match` needs `TMDB_API_KEY` in the repo-root `.env` (v3 key goes in the `api_key` param, a v4 JWT token as Bearer header).
  Requests are throttled to 4/s and cached by URL in `import/cache/`; the key is never written anywhere.
- `review.md` lists uncertain lines as `### <id>. <title>` with numbered candidates, `0) skip`, `m) manual`.
  Record answers in `import/decisions.json`: `{ "12": 1, "13": 0, "14": "m" }` (ids are the line number, or `line.n` for expanded multi-film lines).
- `build` prints counts and fails (exit 1) listing undecided ids unless they are decided or `--allow-pending` is passed.

Tests (no network, hand-built TMDB-shaped fixtures):

```bash
npx vitest run --config apps/cinefilo/scripts/keep-import/vitest.config.mjs
node node_modules/eslint/bin/eslint.js apps/cinefilo/scripts/keep-import
```

Notes: a `/` splits two titles only when spaced (`A / B`; `Face/Off` stays one). `(trilogy)` and `Base 1, 2, 3` use TMDB
collections ordered by release date. Series use kind `series` (the app's kind). Display title is the es-ES one.
`build` mirrors `parseTitlesFile` locally (`validateTitlesFile`); wire the app's real parser in afterwards.
