import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, tab } from './fixtures.ts';

/** Fixed ids so the generated covers (seeded by title id) look the same on every run. */
const uuid = (n: number, p: string) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-02-01T12:00:00.000Z';

type V = 'like' | 'meh' | 'dislike' | null;
interface Seed {
  title: string; kind: 'movie' | 'series'; year: number; status: 'later' | 'watching' | 'watched';
  watchedOn?: string; season?: number; seasons?: number; runtime?: number;
  mine: V; partner: V; mineReview?: string; partnerReview?: string;
}

/** The screenshot catalogue: four films and four series, two members, varied verdicts, short original reviews. */
export const SEEDS: readonly Seed[] = [
  { title: 'The Brutalist', kind: 'movie', year: 2024, status: 'watched', watchedOn: '2026-01-20', runtime: 215, mine: 'like', partner: 'meh',
    mineReview: 'Long and quiet, and the intermission earned its place.', partnerReview: 'Gorgeous rooms, but I kept checking the clock.' },
  { title: 'The Godfather', kind: 'movie', year: 1972, status: 'watched', watchedOn: '2026-01-14', runtime: 175, mine: 'like', partner: 'like',
    mineReview: 'Rewatched on a rainy Sunday and it held up better than I remembered.', partnerReview: 'Slow in the best way, and nobody wastes a line.' },
  { title: 'Back to the Future', kind: 'movie', year: 1985, status: 'watched', watchedOn: '2026-01-03', runtime: 116, mine: 'meh', partner: 'like',
    partnerReview: 'Pure fun, and the plot clicks together like a watch.' },
  { title: 'Inception', kind: 'movie', year: 2010, status: 'later', runtime: 148, mine: null, partner: null },
  { title: 'Peaky Blinders', kind: 'series', year: 2013, status: 'later', seasons: 6, mine: null, partner: 'like' },
  { title: 'The Bear', kind: 'series', year: 2022, status: 'watching', season: 3, seasons: 4, mine: 'like', partner: 'like' },
  { title: 'Better Call Saul', kind: 'series', year: 2015, status: 'watching', season: 6, seasons: 6, mine: 'like', partner: 'dislike',
    partnerReview: 'Started strong, then I lost the thread.' },
  { title: 'The Simpsons', kind: 'series', year: 1989, status: 'watching', season: 8, seasons: 36, mine: 'meh', partner: null },
];

/** Import the catalogue as a `cinefilo/v1` file around the member this device already is; Luz is the partner. */
/** `numbered` gives the watched seeds their history place, first watched = #1 (cinefilo-feedback-1). */
export async function importCatalogue(page: Page, opts: { numbered?: boolean } = {}): Promise<void> {
  await tab(page, 'Settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  const base = JSON.parse(await readFile(await download.path(), 'utf8')) as { members: { id: string }[] };
  const me = base.members[0]!.id;
  const luz = uuid(1, 'a0000000');
  const watchedFirst = SEEDS.filter((s) => s.status === 'watched').sort((a, b) => (a.watchedOn! < b.watchedOn! ? -1 : 1)).map((s) => s.title);
  const titles = SEEDS.map((s, i) => ({
    id: uuid(i + 1, 'b0000000'), kind: s.kind, title: s.title, originalTitle: null, year: s.year, tmdbId: null, posterUrl: null, genres: null,
    runtimeMin: s.runtime ?? null, seasonCount: s.seasons ?? null, status: s.status, watchedOn: s.watchedOn ?? null,
    currentSeason: s.season ?? null, mergedInto: null, addedBy: me, createdAt: NOW, deletedAt: null,
    ...(opts.numbered && s.status === 'watched' ? { watchOrder: watchedFirst.indexOf(s.title) + 1 } : {}),
  }));
  const ratings = SEEDS.flatMap((s, i) =>
    ([[me, s.mine, s.mineReview], [luz, s.partner, s.partnerReview]] as const)
      .filter(([, v, r]) => v !== null || r)
      .map(([m, v, r], k) => ({
        id: uuid(i * 2 + k + 1, 'c0000000'), titleId: titles[i]!.id, memberId: m, verdict: v, review: r ?? null, updatedAt: NOW, deletedAt: null,
      })),
  );
  const file = { format: 'cinefilo/v1', exportedAt: NOW, titles, members: [{ id: luz, name: 'Luz', createdAt: '2030-01-01T00:00:00.000Z', deletedAt: null }], ratings };
  await page.locator('#import-file').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByText(`Imported ${titles.length + 1 + ratings.length} items.`)).toBeVisible();
}

export type PlainSeed = { name: string; mine: string | null; partner: string | null };

const SEED_NOW = '2025-01-01T00:00:00.000Z';

/** Build a `cinefilo/v1` file around the member this device already is, and import it through Settings. */
export async function importSeed(page: Page, seeds: PlainSeed[]): Promise<void> {
  await tab(page, 'Settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  const base = JSON.parse(await (await import('node:fs/promises')).readFile((await download.path()), 'utf8')) as { members: { id: string }[] };
  const me = base.members[0]!.id;
  const luz = randomUUID();
  const titles = seeds.map((s) => ({
    id: randomUUID(), kind: 'movie', title: s.name, originalTitle: null, year: 2000, tmdbId: null, posterUrl: null, genres: null,
    runtimeMin: null, seasonCount: null, status: 'watched', watchedOn: '2025-01-02', currentSeason: null, mergedInto: null,
    addedBy: me, createdAt: SEED_NOW, deletedAt: null,
  }));
  const ratings = seeds.flatMap((s, i) =>
    ([[me, s.mine], [luz, s.partner]] as const)
      .filter(([, v]) => v !== null)
      .map(([m, v]) => ({ id: randomUUID(), titleId: titles[i]!.id, memberId: m, verdict: v, review: null, updatedAt: SEED_NOW, deletedAt: null })),
  );
  const file = {
    format: 'cinefilo/v1', exportedAt: SEED_NOW, titles,
    members: [{ id: luz, name: 'Luz', createdAt: '2030-01-01T00:00:00.000Z', deletedAt: null }],
    ratings,
  };
  await page.locator('#import-file').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByText(`Imported ${titles.length + 1 + ratings.length} items.`)).toBeVisible();
}
