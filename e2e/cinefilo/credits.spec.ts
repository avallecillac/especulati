import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, startList, tab, test } from './fixtures.ts';
import { installTmdb, saveKey } from './tmdb.ts';

test.use({ viewport: { width: 390, height: 844 } });

const themes = [['Béton', 'beton'], ['Willis', 'willis']] as const;
const NOW = '2026-02-01T12:00:00.000Z';
const uuid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Import a backup whose titles are linked to TMDB and have every detail except the credits (an "already linked" list). */
async function importLinked(page: Page, rows: { n: number; title: string; tmdbId: number; kind: 'movie' | 'series'; year: number }[]): Promise<void> {
  await tab(page, 'Settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  const base = JSON.parse(await readFile(await download.path(), 'utf8')) as { members: { id: string }[] };
  const me = base.members[0]!.id;
  const titles = rows.map((r) => ({
    id: uuid(r.n), kind: r.kind, title: r.title, originalTitle: null, year: r.year, tmdbId: r.tmdbId, posterUrl: '/old.jpg', genres: ['Drama'],
    runtimeMin: null, seasonCount: null, status: 'watched', watchedOn: '2026-01-02', currentSeason: null, mergedInto: null, addedBy: me, createdAt: NOW, deletedAt: null,
  }));
  const file = { format: 'cinefilo/v1', exportedAt: NOW, titles, members: [], ratings: [] };
  await page.locator('#import-file').setInputFiles({ name: 'linked.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByText(`Imported ${titles.length} items.`)).toBeVisible();
}

for (const [name, id] of themes) {
  test(`${name}: adding from TMDB shows countries, genres, creators and only the actor when there is no actress`, async ({ page, context }) => {
    await installTmdb(context);
    await page.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), id);
    await startList(page, 'Ana');
    await saveKey(page);
    await tab(page, 'Watch later').click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a title' });
    await sheet.getByRole('button', { name: 'Series' }).click();
    await sheet.getByLabel('Search TMDB').fill('Severance');
    await sheet.getByRole('button', { name: 'Search', exact: true }).click();
    await sheet.getByRole('button', { name: 'Add Severance (2022)' }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole('link', { name: /Severance/ }).click();

    const facts = page.getByTestId('title-facts');
    await expect(facts).toContainText('United States');
    await expect(facts).toContainText('Drama · Mystery · Sci-Fi & Fantasy');
    await expect(facts).toContainText('Created by Dan Erickson');
    await expect(facts.getByText('With Adam Scott', { exact: true })).toBeVisible();
    await expect(facts).not.toContainText('Britt');
    // The ratings stay on the first screen at phone size.
    await expect(page.getByRole('heading', { name: 'Ratings' })).toBeInViewport();
  });
}

test('a title linked earlier is backfilled with its credits and found by director, actor and country', async ({ page, context }) => {
  const tmdb = await installTmdb(context);
  const api = () => tmdb.requests.filter((r) => r.host === 'api.themoviedb.org');
  await startList(page, 'Ana');
  await importLinked(page, [
    { n: 1, title: 'The Godfather', tmdbId: 238, kind: 'movie', year: 1972 },
    { n: 2, title: 'In the Mood for Love', tmdbId: 843, kind: 'movie', year: 2000 },
  ]);
  await tab(page, 'Watched').click();
  const search = page.getByRole('searchbox', { name: 'Search titles' });
  await expect(search).toHaveAttribute('placeholder', 'Search titles, people, genres');
  await expect(page.getByRole('link', { name: /Godfather/ })).toBeVisible();
  await search.fill('coppola');
  await expect(page.getByRole('link', { name: /Godfather/ })).toHaveCount(0);

  // No key: nothing is requested and nothing matches yet.
  await page.waitForTimeout(2500);
  expect(api()).toEqual([]);

  await saveKey(page);
  await tab(page, 'Watched').click();
  await expect.poll(() => api().length, { timeout: 30_000 }).toBe(2);
  const at = api().map((r) => r.at);
  expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(1800);
  const apiPaths = api().map((r) => r.path).sort();
  expect(apiPaths).toEqual(['/3/movie/238', '/3/movie/843']);

  await page.getByRole('searchbox', { name: 'Search titles' }).fill('coppola');
  await expect(page.getByRole('link', { name: /Godfather/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: /Mood/ })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search titles' }).fill('brando');
  await expect(page.getByRole('link', { name: /Godfather/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search titles' }).fill('france');
  await expect(page.getByRole('link', { name: /Mood/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Godfather/ })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search titles' }).fill('zzz');
  await expect(page.getByText('No titles match')).toBeVisible();

  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('link', { name: /Godfather/ }).click();
  const facts = page.getByTestId('title-facts');
  await expect(facts).toContainText('United States');
  await expect(facts).toContainText('Directed by Francis Ford Coppola');
  await expect(facts).toContainText('With Marlon Brando, Diane Keaton');

  // Fetched once: a reload does not ask TMDB again.
  const before = api().length;
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.waitForTimeout(3000);
  expect(api().length).toBe(before);
});
