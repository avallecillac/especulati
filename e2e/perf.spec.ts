import { expect, test } from '@playwright/test';
import { addBook, openApp, openLogSheet } from './helpers.ts';

test('cold start of the production build shows the Home card in < 1.5 s (plan Performance Goals)', async ({ page }) => {
  await openApp(page);
  for (const title of ['One', 'Two', 'Three']) await addBook(page, { title, pages: 300 });
  const sheet = await openLogSheet(page);
  await sheet.getByLabel('Page', { exact: true }).fill('42');
  await sheet.getByRole('button', { name: 'Save' }).click();

  const requested: string[] = [];
  page.on('requestfinished', (r) => requested.push(r.url()));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Current book' })).toBeVisible();
  const ms = await page.evaluate(() => performance.getEntriesByName('home-rendered')[0]!.startTime);
  console.log(`cold start → home card: ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(1500);
  // The barcode decoder is loaded only on the scan screen (feature 002).
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.filter((u) => u.includes('zxing_reader'))).toEqual([]);
});

test('the Stats headline appears within 200 ms of navigating to #/stats (003 SC-001)', async ({ page }) => {
  await openApp(page);
  for (const title of ['One', 'Two', 'Three']) await addBook(page, { title, pages: 300 });
  const sheet = await openLogSheet(page);
  await sheet.getByLabel('Page', { exact: true }).fill('42');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();

  await page.evaluate(() => { location.hash = '#/stats'; performance.mark('stats-nav'); });
  await expect(page.getByRole('heading', { name: /reading days? in \d{4}$/ })).toBeVisible();
  const ms = await page.evaluate(() => performance.now() - performance.getEntriesByName('stats-nav')[0]!.startTime);
  console.log(`#/stats → headline: ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(200);
});
