import type { Page } from '@playwright/test';
import { addBook, currentCard, openLogSheet } from './helpers';
import { expect, test } from './fixtures/catalog';

const DUNE = '9780441172719';

/** Dune added by hand: no pages, no ISBN, no author, one logged entry; then Edit → lookup. */
async function manualDuneThenLookup(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('ready')).toBeAttached();
  await addBook(page, { title: 'Dune' });
  const sheet = await openLogSheet(page);
  await sheet.getByLabel('Page', { exact: true }).fill('42');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(currentCard(page).getByText('p. 42')).toBeVisible();

  await currentCard(page).getByRole('link', { name: 'Dune' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit book' })).toBeVisible();
  await page.getByLabel('ISBN').fill(DUNE);
  await page.getByRole('button', { name: 'Look up details' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Found in' })).toBeVisible();
  const group = page.getByRole('group', { name: 'Fetched details' });
  await expect(group).toBeVisible();
  return group;
}

test('(11) edit a manual book: fetch by ISBN, apply only the page count', async ({ page }) => {
  const group = await manualDuneThenLookup(page);

  const boxes = group.getByRole('checkbox');
  for (const name of ['Title', 'Author', 'Total pages', 'Genre', 'Cover']) {
    await expect(group.getByRole('checkbox', { name })).not.toBeChecked();
  }
  expect(await boxes.count()).toBe(5);
  await expect(group).toContainText('535');

  await group.getByRole('checkbox', { name: 'Total pages' }).check();
  await page.getByRole('button', { name: 'Save book' }).click();

  await expect(page).toHaveURL(/#\/book\//);
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible();
  await expect(page.getByText('p. 42 / 535')).toBeVisible();
  await expect(page.getByText(DUNE)).toBeVisible();
  await expect(page.getByText('Frank Herbert')).toBeHidden();
  await expect(page.getByText('Science fiction')).toBeHidden();
  // History untouched.
  await expect(page.getByRole('list', { name: 'History' }).getByText('Page 42')).toBeVisible();
  // No cover stored: the generated one stays.
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
});

test('(11b) checking Cover stores it and shows it', async ({ page }) => {
  const group = await manualDuneThenLookup(page);
  await group.getByRole('checkbox', { name: 'Cover' }).check();
  await page.getByRole('button', { name: 'Save book' }).click();

  await expect(page).toHaveURL(/#\/book\//);
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible();
  await expect(page.locator('img[src^="blob:"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Frank Herbert')).toBeHidden();
  await expect(page.getByText('p. 42')).toBeVisible();
});

test('an invalid ISBN in edit mode is refused', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('ready')).toBeAttached();
  await addBook(page, { title: 'Dune' });
  await currentCard(page).getByRole('link', { name: 'Dune' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('ISBN').fill('9780441172718');
  await page.getByRole('button', { name: 'Look up details' }).click();
  await expect(page.getByText("That isn't a valid ISBN — check the digits.")).toBeVisible();
});
