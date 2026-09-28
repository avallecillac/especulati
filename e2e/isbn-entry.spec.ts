import { currentCard } from './helpers';
import { expect, test } from './fixtures/catalog';

test('(3) camera denied: type an ISBN-10 with hyphens, look it up, save the normalized ISBN', async ({ page, catalog, fakeCamera }) => {
  fakeCamera.deny();
  await page.goto('/#/scan');
  await expect(page.getByText('Camera permission was denied.')).toBeVisible();
  await page.getByRole('button', { name: 'Enter ISBN' }).click();
  await expect(page).toHaveURL(/#\/isbn$/);
  await expect(page.getByRole('heading', { name: 'Enter ISBN' })).toBeVisible();

  const field = page.getByLabel('ISBN');
  await expect(field).toHaveAttribute('inputmode', 'text');
  await expect(field).toHaveAttribute('autocomplete', 'off');
  await field.fill('0-441-47812-3');
  await page.getByRole('button', { name: 'Look up' }).click();

  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByLabel('Title')).toHaveValue('The Left Hand of Darkness');
  expect(catalog.requests().some((u) => u.includes('isbn=9780441478125'))).toBe(true);

  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await currentCard(page).getByRole('link', { name: 'The Left Hand of Darkness' }).click();
  await expect(page.getByText('ISBN 9780441478125')).toBeVisible();
});

test('(4) an invalid ISBN shows an inline error and sends no request', async ({ page, catalog }) => {
  await page.goto('/#/isbn');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByLabel('ISBN').fill('9780441172718');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByText("That isn't a valid ISBN — check the digits.")).toBeVisible();
  await expect(page).toHaveURL(/#\/isbn$/);
  expect(catalog.requests()).toHaveLength(0);
});

test('typing an ISBN already in the library offers to open it or add a copy', async ({ page }) => {
  await page.goto('/#/isbn');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByLabel('ISBN').fill('9780441172719');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByLabel('Title')).toHaveValue('Dune');
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);

  await page.goto('/#/isbn');
  await page.getByLabel('ISBN').fill('0441172717');
  await page.getByRole('button', { name: 'Look up' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Already in your library' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open existing' }).click();
  await expect(page).toHaveURL(/#\/book\//);
});
