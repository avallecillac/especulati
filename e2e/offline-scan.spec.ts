import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/catalog';

const A = '9780593135204';
const B = '9781250301697';
const MISSING = '9791299999991';

const OFFLINE_LINE = "Details will be looked up when you're online.";

const libraryRow = (page: Page, name: string | RegExp) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name }) });

test('(5) offline saves stay pending; the retry fills A and never touches edited B', async ({ page, context, catalog, fakeCamera }) => {
  await fakeCamera.show(A);
  await page.goto('/');
  await expect(page.getByTestId('ready')).toBeAttached();
  await context.setOffline(true);

  for (const isbn of [A, B]) {
    await fakeCamera.show(isbn);
    await page.goto('/#/scan');
    await expect(page).toHaveURL(/#\/add$/, { timeout: 15_000 });
    await expect(page.getByText(`ISBN ${isbn}`)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: OFFLINE_LINE })).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue('');
    await page.getByRole('button', { name: 'Save book' }).click();
    await expect(page).toHaveURL(/#\/$/);
  }

  await page.getByRole('link', { name: 'Library', exact: true }).click();
  for (const isbn of [A, B]) {
    const row = libraryRow(page, `ISBN ${isbn}`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Details pending')).toBeVisible();
  }

  await libraryRow(page, `ISBN ${B}`).getByRole('link').click();
  await expect(page.getByRole('heading', { name: `ISBN ${B}` })).toBeVisible();
  await expect(page.getByText('Details pending')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Author').fill('A. Michaelides (typed)');
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page.getByText('A. Michaelides (typed)')).toBeVisible();
  await expect(page.getByText('Details pending')).toBeHidden();

  await context.setOffline(false);
  const before = catalog.requests().length;
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.goto('/#/library');

  await expect(libraryRow(page, 'Project Hail Mary')).toBeVisible({ timeout: 15_000 });
  await expect(libraryRow(page, 'Project Hail Mary')).toContainText('496 pages');
  await expect(libraryRow(page, 'Project Hail Mary').getByText('Details')).toBeHidden();
  await libraryRow(page, 'Project Hail Mary').getByRole('link').click();
  await expect(page.getByText('Andy Weir')).toBeVisible();
  await expect(page.getByText('Details pending')).toBeHidden();

  await page.goto('/#/library');
  const rowB = libraryRow(page, `ISBN ${B}`);
  await expect(rowB).toBeVisible();
  await expect(rowB.getByText('Details')).toBeHidden();
  await rowB.getByRole('link').click();
  await expect(page.getByText('A. Michaelides (typed)')).toBeVisible();

  const after = catalog.requests().slice(before);
  expect(after.some((u) => u.includes(A))).toBe(true);
  expect(after.filter((u) => u.includes(B))).toEqual([]);
});

test('(6) a catalog miss saves as "Details not found" and is not retried', async ({ page, catalog, fakeCamera }) => {
  catalog.miss(MISSING);
  await fakeCamera.show(MISSING);
  await page.goto('/#/scan');
  await expect(page).toHaveURL(/#\/add$/, { timeout: 15_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Not found in book catalogs' })).toBeVisible();
  await page.getByLabel('Title').fill('Typed Title');
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('region', { name: 'Current book' }).getByText('Details not found')).toBeVisible();

  const before = catalog.requests().length;
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await expect(page.getByRole('region', { name: 'Current book' }).getByText('Details not found')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(catalog.requests().slice(before).filter((u) => u.includes(MISSING))).toEqual([]);
});

test('(7) a slow catalog times out after 8 s; saving is still pending', async ({ page, catalog, fakeCamera }) => {
  test.setTimeout(45_000);
  catalog.delay(9000);
  await fakeCamera.show(A);
  await page.goto('/#/scan');
  await expect(page).toHaveURL(/#\/add$/, { timeout: 15_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Looking up' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Taking too long — continue without details.' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('region', { name: 'Current book' }).getByText('Details pending')).toBeVisible();
});
