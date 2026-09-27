import { expect, test } from '@playwright/test';
import { addBook, currentCard, lastReadDate, openApp, openLogSheet } from './helpers.ts';

test.describe('US1: log progress on the current book', () => {
  test('pre-fills the last page; saving 145 updates the card within 100 ms (SC-002)', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });

    let sheet = await openLogSheet(page);
    await sheet.getByLabel('Page', { exact: true }).fill('120');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(currentCard(page).getByText('p. 120 / 300')).toBeVisible();

    sheet = await openLogSheet(page);
    await expect(sheet.getByLabel('Page', { exact: true })).toHaveValue('120');
    await expect(sheet.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByLabel('Page', { exact: true }).fill('145');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(currentCard(page).getByText('p. 145 / 300')).toBeVisible();
    await expect(page.getByRole('status').getByText('Saved').last()).toBeVisible();

    const ms = await page.evaluate(() => {
      const start = performance.getEntriesByName('log-save').at(-1)!.startTime;
      const shown = performance.getEntriesByName('home-rendered').filter((e) => e.startTime > start).at(0)!.startTime;
      return shown - start;
    });
    expect(ms).toBeLessThan(100);
  });

  test('Read today saves a page-less entry dated today', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T09:00:00-04:00') });
    await openApp(page);
    await addBook(page, { title: 'Solaris' });
    const sheet = await openLogSheet(page);
    await sheet.getByRole('button', { name: 'Read today' }).click();
    await expect(sheet).toBeHidden();
    expect(await lastReadDate(page)).toBe('2026-06-15');
    await expect(currentCard(page).getByText('No page logged yet')).toBeVisible();
  });

  test('Yesterday at 00:05 (day after the DST change) saves the previous calendar date', async ({ page }) => {
    // America/New_York is set in playwright.config.ts; DST began 2026-03-08.
    await page.clock.install({ time: new Date('2026-03-09T00:05:00-04:00') });
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });
    expect(await lastReadDate(page)).toBe('2026-03-09');

    const sheet = await openLogSheet(page);
    await sheet.getByRole('button', { name: 'Yesterday' }).click();
    await expect(sheet.getByRole('button', { name: 'Yesterday' })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByLabel('Page', { exact: true }).fill('20');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(currentCard(page).getByText('p. 20 / 300')).toBeVisible();
    // The start entry (today) is still the latest; the backdated entry sits before it.
    expect(await lastReadDate(page)).toBe('2026-03-09');
  });

  test('saving the last page asks "Mark as finished?" — confirm finishes, decline keeps reading', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Short', pages: 50 });
    let sheet = await openLogSheet(page);
    await sheet.getByLabel('Page', { exact: true }).fill('50');
    await sheet.getByRole('button', { name: 'Save' }).click();
    const prompt = page.getByRole('alertdialog', { name: 'Mark as finished?' });
    await prompt.getByRole('button', { name: 'Not yet' }).click();
    await expect(currentCard(page).getByText('Reading')).toBeVisible();

    sheet = await openLogSheet(page);
    await sheet.getByLabel('Page', { exact: true }).fill('50');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('alertdialog', { name: 'Mark as finished?' }).getByRole('button', { name: 'Mark finished' }).click();
    await expect(page.getByText('No book in progress')).toBeVisible();
  });

  test('a book with unknown total pages can be finished from the log sheet', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'No pages' });
    const sheet = await openLogSheet(page);
    await sheet.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByText('No book in progress')).toBeVisible();
  });

  test('SC-001: from a cold start, log progress with exactly 2 clicks and one fill in < 5 s', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 300 });

    let clicks = 0;
    const click = async (l: ReturnType<typeof page.getByRole>) => { clicks++; await l.click(); };
    const started = Date.now();
    await page.goto('/');
    await click(currentCard(page).getByRole('button', { name: 'Log' }));
    const sheet = page.getByRole('dialog', { name: 'Log progress' });
    await sheet.getByLabel('Page', { exact: true }).fill('33');
    await click(sheet.getByRole('button', { name: 'Save' }));
    await expect(currentCard(page).getByText('p. 33 / 300')).toBeVisible();
    expect(clicks).toBe(2);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
