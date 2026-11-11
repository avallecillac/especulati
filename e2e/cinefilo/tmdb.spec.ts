import { addByHand, expect, openApp, startList, tab, test } from './fixtures.ts';
import { installTmdb, KEY, saveKey } from './tmdb.ts';

const openAdd = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  return page.getByRole('dialog', { name: 'Add a title' });
};

test('without a key the sheet says why search is unavailable, and manual add still works', async ({ page, context }) => {
  const tmdb = await installTmdb(context);
  await startList(page, 'Ana');
  const sheet = await openAdd(page);
  await expect(sheet.getByTestId('search-unavailable')).toContainText('TMDB key');
  await expect(sheet.getByLabel('Search TMDB')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await addByHand(page, { title: 'Stalker', year: '1979' });
  await expect(page.getByRole('link', { name: /Stalker/ })).toBeVisible();
  expect(tmdb.requests).toEqual([]);
});

test('Settings → About shows the TMDB logo and the required notice', async ({ page, context }) => {
  await installTmdb(context);
  await startList(page, 'Ana');
  await tab(page, 'Settings').click();
  await expect(page.getByRole('img', { name: 'Powered by TMDB' })).toBeVisible();
  await expect(page.getByTestId('tmdb-attribution')).toHaveText('This product uses the TMDB API but is not endorsed or certified by TMDB.');
});

test('search, add in one tap, poster shows and survives offline; the key goes only to TMDB', async ({ page, context }) => {
  const tmdb = await installTmdb(context);
  await page.addInitScript(() => localStorage.setItem('cinefilo.covers', 'posters'));
  await startList(page, 'Ana');
  await saveKey(page);
  await tab(page, 'Watch later').click();

  const sheet = await openAdd(page);
  await sheet.getByRole('button', { name: 'Series' }).click();
  await sheet.getByLabel('Search TMDB').fill('Severance');
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  // Results are on screen. Movie hits are narrowed out by the toggle. From here: one tap.
  await expect(sheet.getByRole('list', { name: 'Search results' }).getByRole('listitem')).toHaveCount(1);
  let taps = 0;
  taps++;
  await sheet.getByRole('button', { name: 'Add Severance (2022)' }).click();
  expect(taps).toBeLessThanOrEqual(2);
  await expect(sheet).toBeHidden();

  const row = page.getByRole('link', { name: /Severance/ });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('poster-img')).toHaveAttribute('src', /^blob:/, { timeout: 10_000 });
  await row.click();
  await expect(page.getByText('Series · 2022')).toBeVisible();

  // The first fetch stored it: offline after a reload, the poster still shows.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  const img = page.getByTestId('poster-img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(tmdb.posterFetches()).toBe(1);

  expect(tmdb.unmatched).toEqual([]);
  expect(tmdb.requests.map((r) => r.host).every((h) => h === 'api.themoviedb.org' || h === 'image.tmdb.org')).toBe(true);
  expect(tmdb.requests.filter((r) => r.hasKey).every((r) => r.host === 'api.themoviedb.org')).toBe(true);
  expect(tmdb.requests.some((r) => r.path === '/3/tv/95396')).toBe(true);
});

test('offline: the add sheet offers manual entry only; a TMDB failure keeps the typed text', async ({ page, context }) => {
  const tmdb = await installTmdb(context);
  await startList(page, 'Ana');
  await saveKey(page);
  await tab(page, 'Watch later').click();

  tmdb.failWith(500);
  let sheet = await openAdd(page);
  await sheet.getByLabel('Search TMDB').fill('Severance');
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(sheet.getByTestId('search-note')).toContainText('could not answer');
  await expect(sheet.getByLabel('Title')).toHaveValue('Severance');
  tmdb.failWith(401);
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(sheet.getByTestId('search-note')).toContainText('did not accept your key');
  await expect(sheet.getByTestId('search-note')).not.toContainText(KEY);
  await sheet.getByRole('button', { name: 'Add title' }).click();
  await expect(page.getByRole('link', { name: /Severance/ })).toBeVisible();

  await context.setOffline(true);
  sheet = await openAdd(page);
  await expect(sheet.getByTestId('search-unavailable')).toContainText('offline');
  await sheet.getByLabel('Title').fill('Heat');
  await sheet.getByRole('button', { name: 'Add title' }).click();
  await expect(page.getByRole('link', { name: /Heat/ })).toBeVisible();
});

test('Link to TMDB fills details and keeps status, date and both ratings', async ({ page: a, newDevice, context }) => {
  await installTmdb(context);
  await a.addInitScript(() => localStorage.setItem('cinefilo.covers', 'posters'));
  const code = await startList(a, 'Ana');
  await addByHand(a, { title: 'Severance', kind: 'Series', status: 'Watched' });
  const sync = async (p: typeof a) => {
    await tab(p, 'Settings').click();
    await p.getByRole('button', { name: 'Sync now' }).click();
    await expect(p.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  };
  await sync(a); // push now rather than wait for the write timer
  const b = await newDevice();
  await installTmdb(b.context);
  await openApp(b.page);
  await b.page.getByRole('button', { name: 'Join with a code' }).click();
  await b.page.getByLabel('Sync code').fill(code);
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await b.page.getByLabel("I'm new").fill('Luz');
  await b.page.getByRole('button', { name: 'Create me' }).click();

  await tab(b.page, 'Watched').click();
  await b.page.getByRole('link', { name: /Severance/ }).click();
  await b.page.getByTestId('rating-mine').getByRole('button', { name: "Didn't like" }).click();
  await b.page.getByLabel('Your review').fill('Too slow.');
  await b.page.getByRole('button', { name: 'Save review' }).click();
  await tab(a, 'Watched').click();
  await a.getByRole('link', { name: /Severance/ }).click();
  await a.getByTestId('rating-mine').getByRole('button', { name: 'Like', exact: true }).click();
  await sync(b.page);
  await sync(a);
  await tab(a, 'Watched').click();
  await a.getByRole('link', { name: /Severance/ }).click();
  await expect(a.getByTestId('rating-partner')).toContainText('Too slow.');
  const watchedOn = await a.locator('time').getAttribute('datetime');

  await saveKey(a);
  await tab(a, 'Watched').click();
  await a.getByRole('link', { name: /Severance/ }).click();
  await a.getByRole('button', { name: 'Link to TMDB' }).click();
  await a.getByRole('button', { name: 'Search', exact: true }).click();
  await a.getByRole('button', { name: 'Link Severance (2022)' }).click();
  await expect(a.getByText('Series · 2022')).toBeVisible();
  await expect(a.getByRole('button', { name: 'Link to TMDB' })).toHaveCount(0);
  await expect(a.getByTestId('poster-img')).toHaveAttribute('src', /^blob:/, { timeout: 10_000 });
  await expect(a.locator('time')).toHaveAttribute('datetime', watchedOn!);
  await expect(a.getByTestId('rating-mine').getByRole('button', { name: 'Like', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(a.getByTestId('rating-partner')).toContainText("Didn't like");
  await expect(a.getByTestId('rating-partner')).toContainText('Too slow.');
});
