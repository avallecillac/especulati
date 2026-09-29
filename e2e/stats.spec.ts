import { expect, test } from '@playwright/test';
import { addBook, logOnDay, openApp, openLogSheet } from './helpers.ts';

const statsTab = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Stats' });

test.describe('US1: reading days, heatmap and streaks', () => {
  test('empty DB shows 0 reading days and the hint, not an error (FR-019)', async ({ page }) => {
    await openApp(page);
    await statsTab(page).click();
    await expect(page).toHaveURL(/#\/stats$/);
    await expect(page.getByRole('heading', { name: /^0 reading days in \d{4}$/ })).toBeVisible();
    await expect(page.getByText('Log reading from a book to see stats here.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the Stats tab is one tap from Home (SC-004)', async ({ page }) => {
    await openApp(page);
    await expect(statsTab(page)).toBeVisible();
  });

  test('a backdated day counts: 2 reading days, streak 2, accessible heatmap cells', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T13:00:00Z') });
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });

    let sheet = await openLogSheet(page);
    await sheet.getByLabel('Page', { exact: true }).fill('20');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();

    sheet = await openLogSheet(page);
    await sheet.getByRole('button', { name: 'Yesterday' }).click();
    await sheet.getByRole('button', { name: 'Read today' }).click();
    await expect(sheet).toBeHidden();

    await statsTab(page).click();
    await expect(page.getByRole('heading', { name: '2 reading days in 2026' })).toBeVisible();
    await expect(page.getByText('Current streak: 2 days')).toBeVisible();
    await expect(page.getByText(/Longest streak: 2 days \(Jun 14, 2026 – Jun 15, 2026\)/)).toBeVisible();

    // Started on Jun 15, so page 20 counts in full even though the Jun 14 entry sorts first (FR-006).
    await expect(page.getByRole('img', { name: 'Jun 15: 20 pages' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Jun 14: read, no pages logged' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Jun 13: no reading' })).toBeVisible();
  });

  test('re-queries without a reload after new logging (FR-020, SC-003)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T13:00:00Z') });
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });
    await statsTab(page).click();
    await expect(page.getByRole('heading', { name: '1 reading day in 2026' })).toBeVisible();

    await logOnDay(page, '2026-06-16', { page: 30 });
    await statsTab(page).click();
    await expect(page.getByRole('heading', { name: '2 reading days in 2026' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Jun 16: 30 pages' })).toBeVisible();
  });

  test('the year picker switches years (only years with data plus this one are offered)', async ({ page }) => {
    await page.clock.install({ time: new Date('2025-12-31T17:00:00Z') });
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });
    await logOnDay(page, '2026-01-01', { page: 10 });
    await logOnDay(page, '2026-01-02', { page: 20 });
    await statsTab(page).click();
    await expect(page.getByRole('heading', { name: '2 reading days in 2026' })).toBeVisible();
    await expect(page.getByLabel('Year').locator('option')).toHaveText(['2026', '2025']);
    await page.getByLabel('Year').selectOption('2025');
    await expect(page.getByRole('heading', { name: '1 reading day in 2025' })).toBeVisible();
  });
});
