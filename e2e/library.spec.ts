import { expect, test, type Page } from '@playwright/test';
import { addBook, currentCard, openApp, openLogSheet } from './helpers.ts';

const section = (page: Page, name: string) => page.getByRole('region', { name });
const openBook = async (page: Page, title: string) => {
  await page.goto('/#/library');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
};

test.describe('US3: library and book history', () => {
  test('groups by status; Start, Abandon (with confirmation) and re-read move books between groups', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Queued one', start: false });
    await addBook(page, { title: 'Done one', pages: 10 });
    const sheet = await openLogSheet(page);
    await sheet.getByRole('button', { name: 'Finish' }).click();

    await page.goto('/#/library');
    await expect(section(page, 'Queued').getByRole('link', { name: 'Queued one' })).toBeVisible();
    await expect(section(page, 'Finished').getByRole('link', { name: 'Done one' })).toBeVisible();

    await openBook(page, 'Queued one');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('Reading', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Abandon' }).click();
    await page.getByRole('alertdialog', { name: 'Abandon this book?' }).getByRole('button', { name: 'Abandon' }).click();
    await page.goto('/#/library');
    await expect(section(page, 'Abandoned').getByRole('link', { name: 'Queued one' })).toBeVisible();

    // Logging on a finished book starts a re-read.
    await openBook(page, 'Done one');
    await page.getByRole('button', { name: 'Log' }).click();
    const log = page.getByRole('dialog', { name: 'Log progress' });
    await log.getByLabel('Page', { exact: true }).fill('3');
    await log.getByRole('button', { name: 'Save' }).click();
    await page.goto('/#/library');
    await expect(section(page, 'Reading').getByRole('link', { name: 'Done one' })).toBeVisible();
  });

  test('history lists entries newest first; edit and remove a book', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Histo', pages: 300 });
    for (const p of ['10', '20']) {
      const s = await openLogSheet(page);
      await s.getByLabel('Page', { exact: true }).fill(p);
      await s.getByRole('button', { name: 'Save' }).click();
      await expect(currentCard(page).getByText(`p. ${p} / 300`)).toBeVisible();
    }
    await openBook(page, 'Histo');
    const rows = page.getByRole('list', { name: 'History' }).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Page 20');
    await expect(rows.nth(1)).toContainText('Page 10');
    await expect(rows.nth(2)).toContainText('Started');

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill('Histo 2');
    await page.getByLabel('Total pages').fill('15');
    await page.getByRole('button', { name: 'Save book' }).click();
    await expect(page.getByText("You've already logged page 20; total pages can't be lower.")).toBeVisible();
    await page.getByLabel('Total pages').fill('320');
    await page.getByRole('button', { name: 'Save book' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Histo 2' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove book' }).click();
    await page.getByRole('alertdialog', { name: 'Remove this book?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page).toHaveURL(/#\/library$/);
    await expect(page.getByRole('link', { name: 'Histo 2' })).toHaveCount(0);
    await page.goto('/#/');
    await expect(page.getByText('No book in progress')).toBeVisible();
  });

  test('with two reading books Home shows the most recent; the other is one tap away', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'First', pages: 100 });
    await addBook(page, { title: 'Second', pages: 100 });
    await expect(currentCard(page).getByRole('heading', { name: 'Second' })).toBeVisible();
    await page.getByRole('button', { name: 'First' }).click();
    await expect(currentCard(page).getByRole('heading', { name: 'First' })).toBeVisible();
  });
});
