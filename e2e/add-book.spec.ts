import { expect, test } from '@playwright/test';
import { addBook, currentCard, openApp } from './helpers.ts';

test.describe('US2: add a book manually', () => {
  test('a title-only book is saved as Queued, not as the current book', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Solaris', start: false });
    await expect(page.getByText('No book in progress')).toBeVisible();
    await expect(page.getByText('1 book queued')).toBeVisible();
  });

  test('"Start reading now" makes it the current book on Home', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Dune', author: 'Frank Herbert', pages: 600 });
    const card = currentCard(page);
    await expect(card.getByRole('heading', { name: 'Dune' })).toBeVisible();
    await expect(card.getByText('Frank Herbert')).toBeVisible();
    await expect(card.getByText('Reading')).toBeVisible();
  });

  test('blank title and 0 pages are rejected inline and nothing is stored', async ({ page }) => {
    await openApp(page, '#/add');
    await page.getByLabel('Title').fill('   ');
    await page.getByRole('button', { name: 'Save book' }).click();
    await expect(page.getByText('Title is required.')).toBeVisible();

    await page.getByLabel('Title').fill('Dune');
    await page.getByLabel('Total pages').fill('0');
    await page.getByRole('button', { name: 'Save book' }).click();
    await expect(page.getByText('Total pages must be a whole number above 0.')).toBeVisible();
    await expect(page).toHaveURL(/#\/add$/);

    await page.goto('/#/');
    await expect(page.getByText('No book in progress')).toBeVisible();
    await expect(page.getByText(/book queued/)).toHaveCount(0);
  });
});
