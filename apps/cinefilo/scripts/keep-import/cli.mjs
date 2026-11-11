#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTitles } from './build.mjs';
import { matchEntries } from './match.mjs';
import { parseList } from './parse.mjs';
import { renderReview } from './review.mjs';
import { createTmdb, readApiKey } from './tmdb.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function options(argv) {
  const o = { input: path.join(root, 'apps/cinefilo/import.md'), out: path.join(root, 'import'), env: path.join(root, '.env'), allowPending: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') o.input = path.resolve(argv[++i]);
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--env') o.env = path.resolve(argv[++i]);
    else if (a === '--allow-pending') o.allowPending = true;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const writeJson = async (file, v) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(v, null, 2)}\n`);
};

const steps = {
  async parse(o) {
    const { entries, dropped } = parseList(await readFile(o.input, 'utf8'));
    await writeJson(path.join(o.out, 'parsed.json'), { entries, dropped });
    const n = (l) => entries.filter((e) => e.list === l).length;
    console.log(`parse: ${entries.length} entries (watched ${n('watched')}, later ${n('later')}), ${dropped.length} duplicates dropped -> ${path.join(o.out, 'parsed.json')}`);
  },
  async match(o) {
    const { entries } = await readJson(path.join(o.out, 'parsed.json'));
    const tmdb = createTmdb({ apiKey: await readApiKey(o.env), cacheDir: path.join(o.out, 'cache') });
    const matches = await matchEntries(entries, tmdb);
    await writeJson(path.join(o.out, 'matches.json'), matches);
    await writeFile(path.join(o.out, 'review.md'), renderReview(matches));
    const unsure = matches.filter((m) => m.status === 'uncertain').length;
    console.log(`match: ${matches.length} lines, ${matches.length - unsure} confident, ${unsure} to review (live ${tmdb.stats.live}, cached ${tmdb.stats.cached}) -> ${path.join(o.out, 'review.md')}`);
  },
  async build(o) {
    const matches = await readJson(path.join(o.out, 'matches.json'));
    const decisions = await readJson(path.join(o.out, 'decisions.json')).catch(() => ({}));
    // Optional extras.json: { "prepend": [title entries placed first], "numberWatched": true }.
    const extras = await readJson(path.join(o.out, 'extras.json')).catch(() => ({}));
    const { file, summary, pending } = buildTitles(matches, decisions, {
      prepend: extras.prepend ?? [],
      numberWatched: extras.numberWatched === true,
    });
    console.log(`build: ${file.titles.length} titles (watched ${summary.watched}, later ${summary.later}), skipped ${summary.skipped}, manual ${summary.manual}, duplicates ${summary.duplicates}, pending ${summary.pending}`);
    if (pending.length && !o.allowPending) {
      console.error(`build: undecided ids: ${pending.join(', ')} (decide them or pass --allow-pending)`);
      process.exitCode = 1;
      return;
    }
    await writeJson(path.join(o.out, 'titles.json'), file);
  },
};

const [step, ...rest] = process.argv.slice(2);
if (!steps[step]) {
  console.error('usage: node apps/cinefilo/scripts/keep-import/cli.mjs parse|match|build [--input f] [--out dir] [--env f] [--allow-pending]');
  process.exit(2);
}
steps[step](options(rest)).catch((e) => {
  console.error(`${step}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
