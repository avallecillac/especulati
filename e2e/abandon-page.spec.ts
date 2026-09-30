import { expect, test, type Page } from '@playwright/test';
import { addBook, logOnDay, openApp } from './helpers.ts';

const openBook = async (page: Page, title: string) => {
  await page.goto('/#/library');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
};

const history = (page: Page) => page.getByRole('list', { name: 'History' }).getByRole('listitem');

/** A 300-page book started and at page 90 on Jun 15, then the clock moves to Jun 16. */
async function readingAt90(page: Page) {
  await page.clock.install({ time: new Date('2026-06-15T13:00:00Z') });
  await openApp(page);
  await addBook(page, { title: 'Dune', pages: 300 });
  await logOnDay(page, '2026-06-15', { page: 90 });
  await page.clock.setFixedTime(new Date('2026-06-16T17:00:00Z'));
  await openBook(page, 'Dune');
}

test.describe('US4: abandoning at a page and days to finish', () => {
  test('abandon at a page: Page 120 then Abandoned, and today is a reading day with 30 pages', async ({ page }) => {
    await readingAt90(page);
    await page.getByRole('button', { name: 'Abandon' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Abandon this book?' });
    const field = dialog.getByLabel('Stopped at page (optional)');
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', '90');
    await field.fill('120');
    await dialog.getByRole('button', { name: 'Abandon' }).click();

    await expect(page.getByText('Abandoned', { exact: true }).first()).toBeVisible();
    // Newest first: the abandon, then the page entry it carried.
    await expect(history(page)).toHaveCount(4);
    await expect(history(page).nth(0)).toContainText('Abandoned');
    await expect(history(page).nth(1)).toContainText('Page 120');

    await page.goto('/#/stats');
    await expect(page.getByRole('img', { name: 'Jun 16: 30 pages' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '2 reading days in 2026' })).toBeVisible();
  });

  test('undo restores Reading at page 90 and removes both entries', async ({ page }) => {
    await readingAt90(page);
    await page.getByRole('button', { name: 'Abandon' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Abandon this book?' });
    await dialog.getByLabel('Stopped at page (optional)').fill('120');
    await dialog.getByRole('button', { name: 'Abandon' }).click();
    await expect(history(page).nth(0)).toContainText('Abandoned');

    await page.getByRole('status').getByRole('button', { name: 'Undo' }).last().click();
    await expect(page.getByText('Reading', { exact: true })).toBeVisible();
    await expect(page.getByText('p. 90 / 300')).toBeVisible();
    await expect(history(page)).toHaveCount(2);
    await expect(page.getByText('Page 120')).toHaveCount(0);
    await expect(page.getByText('Abandoned', { exact: true })).toHaveCount(0);
  });

  test('a bare abandon adds no reading day', async ({ page }) => {
    await readingAt90(page);
    await page.clock.setFixedTime(new Date('2026-06-20T17:00:00Z'));
    await openBook(page, 'Dune');
    await page.getByRole('button', { name: 'Abandon' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Abandon' }).click();
    await expect(history(page).nth(0)).toContainText('Abandoned');

    await page.goto('/#/stats');
    await expect(page.getByRole('heading', { name: '1 reading day in 2026' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Jun 20: no reading' })).toBeVisible();
  });

  test('days to finish is shown on the book screen and averaged on Stats', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T13:00:00Z') });
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });
    await page.clock.setFixedTime(new Date('2026-06-17T17:00:00Z'));
    await openBook(page, 'Dune');
    await page.getByRole('button', { name: 'Finish' }).click();

    await expect(page.getByTestId('read-through')).toContainText('Finished in 3 days');
    await page.goto('/#/stats');
    await expect(page.getByTestId('avg-days-to-finish')).toHaveText('3');
  });
});
