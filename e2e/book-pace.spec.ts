import { expect, test } from '@playwright/test';
import { addBook, logOnDay, openApp } from './helpers.ts';

async function openBook(page: import('@playwright/test').Page, title: string) {
  await page.goto('/#/library');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test.describe('US3: pace and estimated finish on the book screen', () => {
  test('20 pages/day and about 13 days left, with the finish date', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T13:00:00Z') });
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });
    await logOnDay(page, '2026-06-15', { page: 20 });
    await logOnDay(page, '2026-06-16', { page: 40 });

    await openBook(page, 'Dune');
    const pace = page.getByTestId('pace');
    await expect(pace).toContainText('20 pages/day');
    await expect(pace).toContainText('about 13 days left');
    await expect(pace).toContainText('around Jun 29');
  });

  test('a book with no total pages shows no estimate', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T13:00:00Z') });
    await openApp(page);
    await addBook(page, { title: 'Mystery' });
    await logOnDay(page, '2026-06-15', { page: 20 });
    await logOnDay(page, '2026-06-16', { page: 40 });

    await openBook(page, 'Mystery');
    await expect(page.getByTestId('pace')).not.toContainText('days left');
    await expect(page.getByText(/days? left/)).toHaveCount(0);
  });

  test('a book with no progress in the window says there is no recent pace', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T13:00:00Z') });
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });
    await logOnDay(page, '2026-06-16', { page: 20 });
    await logOnDay(page, '2026-07-10', {});

    await openBook(page, 'Dune');
    await expect(page.getByTestId('pace')).toHaveText('No recent pace');
  });
});
