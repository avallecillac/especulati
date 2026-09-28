import { currentCard } from './helpers';
import { expect, test } from './fixtures/catalog';

const HIT = 'The Left Hand of Darkness · Ursula K. Le Guin · 1969';

test('(9) search by title, pick a hit, save with its ISBN', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: 'Search by title' }).click();
  await expect(page).toHaveURL(/#\/search$/);
  await expect(page.getByRole('heading', { name: 'Search by title' })).toBeVisible();

  await page.getByLabel('Title').fill('left hand of darkness');
  await page.getByLabel('Title').press('Enter');
  const hit = page.getByRole('button', { name: HIT });
  await expect(hit).toBeVisible();

  await hit.click();
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByLabel('Title')).toHaveValue('The Left Hand of Darkness');
  await expect(page.getByLabel('Author')).toHaveValue('Ursula K. Le Guin');
  await expect(page.getByLabel('Total pages')).toHaveValue('304');
  await expect(page.getByText('ISBN 9780441478026')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Cover of The Left Hand of Darkness' })).toBeVisible();

  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await currentCard(page).getByRole('link', { name: 'The Left Hand of Darkness' }).click();
  await expect(page.getByText('ISBN 9780441478026')).toBeVisible();
  await expect(page.getByText('Details pending')).toBeHidden();
});

test('a hit whose ISBN is already in the library offers to open it or add a copy', async ({ page }) => {
  await page.goto('/#/search');
  await expect(page.getByTestId('ready')).toBeAttached();
  for (let i = 0; i < 2; i++) {
    await page.goto('/#/search');
    await page.getByLabel('Title').fill('left hand of darkness');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('button', { name: HIT }).click();
    if (i === 0) {
      await expect(page).toHaveURL(/#\/add$/);
      await page.getByRole('button', { name: 'Save book' }).click();
      await expect(page).toHaveURL(/#\/$/);
    }
  }
  const dialog = page.getByRole('alertdialog', { name: 'Already in your library' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Add another copy' }).click();
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByLabel('Title')).toHaveValue('The Left Hand of Darkness');
});

test('no results shows "No matches" and Add manually keeps the query as the title', async ({ page }) => {
  await page.goto('/#/search');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByLabel('Title').fill('zzzz qqqq');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No matches')).toBeVisible();
  await page.getByRole('button', { name: 'Add manually' }).click();
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByLabel('Title')).toHaveValue('zzzz qqqq');
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(currentCard(page).getByRole('link', { name: 'zzzz qqqq' })).toBeVisible();
});

test('offline shows the message and Add manually', async ({ page, context, catalog }) => {
  await page.goto('/#/search');
  await expect(page.getByTestId('ready')).toBeAttached();
  await context.setOffline(true);
  await page.getByLabel('Title').fill('left hand of darkness');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText("Couldn't search — you're offline or the catalogs are unavailable.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add manually' })).toBeVisible();
  expect(catalog.requests().filter((u) => u.includes('search.json'))).toHaveLength(0);
});

test('a query under 3 characters is not sent', async ({ page, catalog }) => {
  await page.goto('/#/search');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByLabel('Title').fill('ab');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Type at least 3 characters.')).toBeVisible();
  expect(catalog.requests()).toHaveLength(0);
});
