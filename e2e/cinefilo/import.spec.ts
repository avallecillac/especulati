import type { Page } from '@playwright/test';
import { expect, openApp, startList, tab, test } from './fixtures.ts';
import { installTmdb, saveKey } from './tmdb.ts';

const list = (titles: unknown[], format = 'cinefilo-titles/v1') => ({
  name: 'titles.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format, titles })),
});

const KEEP = [
  { kind: 'movie', title: 'Heat', year: 1995, status: 'watched' },
  { kind: 'movie', title: 'Stalker', year: 1979, status: 'later' },
  { kind: 'series', title: 'Dark', status: 'watching' },
];

async function pick(page: Page, file: ReturnType<typeof list>) {
  await tab(page, 'Settings').click();
  await page.locator('#import-list-file').setInputFiles(file);
}
const preview = (page: Page) => page.getByRole('dialog', { name: 'Import list preview' });
const syncNow = async (p: Page) => {
  await tab(p, 'Settings').click();
  await p.getByRole('button', { name: 'Sync now' }).click();
  await expect(p.getByRole('button', { name: 'Sync now' })).toBeEnabled();
};

test('a titles list picked through the backup Import button opens the list preview', async ({ page }) => {
  await startList(page, 'Ana');
  await tab(page, 'Settings').click();
  await page.locator('#import-file').setInputFiles(list(KEEP));
  await expect(preview(page).getByTestId('preview-new')).toHaveText('3');
  await expect(page.getByText(/unsupported version/)).toHaveCount(0);
});

test('import: preview, cancel adds nothing, confirm adds, re-import adds 0, partner receives, undated watched', async ({ page: a, newDevice }) => {
  const code = await startList(a, 'Ana');

  await pick(a, list(KEEP));
  await expect(preview(a).getByTestId('preview-new')).toHaveText('3');
  await expect(preview(a).getByTestId('preview-existing')).toHaveText('0');
  await expect(preview(a).getByTestId('preview-invalid')).toHaveText('0');
  await preview(a).getByRole('button', { name: 'Cancel' }).click();
  await expect(preview(a)).toBeHidden();
  await tab(a, 'Watch later').click();
  await expect(a.getByText('Nothing here yet')).toBeVisible();

  await pick(a, list(KEEP));
  await preview(a).getByRole('button', { name: 'Import 3 titles' }).click();
  await expect(a.getByRole('status').filter({ hasText: 'Imported 3 titles.' })).toBeVisible();
  await tab(a, 'Watch later').click();
  await expect(a.getByRole('link', { name: /Stalker/ })).toBeVisible();
  await tab(a, 'Watching').click();
  await expect(a.getByRole('link', { name: /Dark/ })).toBeVisible();

  // Re-importing adds nothing, and the confirm button is off.
  await pick(a, list(KEEP));
  await expect(preview(a).getByTestId('preview-new')).toHaveText('0');
  await expect(preview(a).getByTestId('preview-existing')).toHaveText('3');
  await expect(preview(a).getByRole('button', { name: /^Import/ })).toBeDisabled();
  await preview(a).getByRole('button', { name: 'Cancel' }).click();

  // An undated watched title says so, and "Add date" keeps it watched.
  await tab(a, 'Watched').click();
  await a.getByRole('link', { name: /Heat/ }).click();
  await expect(a.getByTestId('date-unknown')).toHaveText('Watched · date unknown');
  await expect(a.locator('time')).toHaveCount(0);

  await syncNow(a);
  const b = await newDevice();
  await openApp(b.page);
  await b.page.getByRole('button', { name: 'Join with a code' }).click();
  await b.page.getByLabel('Sync code').fill(code);
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await b.page.getByLabel("I'm new").fill('Luz');
  await b.page.getByRole('button', { name: 'Create me' }).click();
  await tab(b.page, 'Watch later').click();
  await expect(b.page.getByRole('link', { name: /Stalker/ })).toBeVisible();
  await tab(b.page, 'Watched').click();
  await b.page.getByRole('link', { name: /Heat/ }).click();
  await expect(b.page.getByTestId('date-unknown')).toBeVisible();
});

test('undated watched: Add date, then it is dated and still watched; undated sort after dated', async ({ page }) => {
  await startList(page, 'Ana');
  await pick(page, list([{ kind: 'movie', title: 'Old', status: 'watched' }, { kind: 'movie', title: 'Dated', status: 'watched' }]));
  await page.getByRole('button', { name: 'Import 2 titles' }).click();
  await tab(page, 'Watched').click();
  await page.getByRole('link', { name: /Dated/ }).click();
  await page.getByRole('button', { name: 'Add date' }).click();
  await page.getByRole('button', { name: 'Yesterday' }).click();
  await expect(page.getByText('Watched on')).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole('button', { name: 'Watched', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.locator('ul.rows .name')).toHaveText([/Dated/, /Old/]); // numbered in import order, newest first (Dated is #2)
});

test('a bad file says why and adds nothing', async ({ page }) => {
  await startList(page, 'Ana');
  await pick(page, list(KEEP, 'cinefilo/v1'));
  await expect(page.getByRole('alert').filter({ hasText: "can't be imported" })).toContainText('format');
  await expect(preview(page)).toHaveCount(0);
  await pick(page, list([{ kind: 'movie', title: 'Heat', status: 'watching' }]));
  await expect(page.getByRole('alert').filter({ hasText: "can't be imported" })).toContainText('titles[0].status');
  await tab(page, 'Watch later').click();
  await expect(page.getByText('Nothing here yet')).toBeVisible();
});

test('imported TMDB titles get details and posters in the background, throttled, only with a key', async ({ page, context }) => {
  const tmdb = await installTmdb(context);
  await page.addInitScript(() => localStorage.setItem('cinefilo.covers', 'posters'));
  await startList(page, 'Ana');
  const file = list([
    { kind: 'series', title: 'Severance', tmdbId: 95396, status: 'later' },
    { kind: 'movie', title: 'Fill me', tmdbId: 843, status: 'later' },
  ]);

  // No key: the import works and nothing is requested.
  await pick(page, file);
  await page.getByRole('button', { name: 'Import 2 titles' }).click();
  await tab(page, 'Watch later').click();
  await expect(page.getByRole('link', { name: /Severance/ })).toBeVisible();
  await page.waitForTimeout(2500);
  expect(tmdb.requests).toEqual([]);

  // With a key the fill starts by itself and the UI stays usable.
  await saveKey(page);
  await tab(page, 'Watch later').click();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: /Severance/ }).getByText('Series · 2022')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: /Severance/ }).getByTestId('poster-img')).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });
  await expect.poll(() => tmdb.requests.some((r) => r.path === '/3/movie/843'), { timeout: 30_000 }).toBe(true);

  // Detail lookups are the throttled queue; a poster is downloaded once per filled title by the existing poster path.
  const at = tmdb.requests.filter((r) => r.host === 'api.themoviedb.org').map((r) => r.at);
  expect(at.length).toBe(2);
  for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(1800);
  expect(tmdb.requests.filter((r) => r.hasKey).every((r) => r.host === 'api.themoviedb.org')).toBe(true);
  expect(tmdb.unmatched).toEqual([]);

  // Resumable: a reload finds nothing left to fetch for the filled title.
  const before = tmdb.requests.filter((r) => r.path === '/3/tv/95396').length;
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.waitForTimeout(3000);
  expect(tmdb.requests.filter((r) => r.path === '/3/tv/95396').length).toBe(before);
});
