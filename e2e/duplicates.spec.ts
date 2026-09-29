import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/relay.ts';
import { addBook, openApp, openLogSheet } from './helpers.ts';

const ISBN = '9780441172719';

/** Add "Dune" (optionally with a page count), give it the ISBN, and log one page. */
async function addDune(page: Page, opts: { pages?: number; logged: number }): Promise<void> {
  await addBook(page, { title: 'Dune', ...(opts.pages ? { pages: opts.pages } : {}) });
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByRole('link', { name: 'Dune' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('ISBN').fill(ISBN);
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/book\//); // saved: the edit form hands over to the detail page
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  const sheet = await openLogSheet(page);
  await sheet.getByLabel('Page', { exact: true }).fill(String(opts.logged));
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
}

/** A (older Dune, no page count) turns sync on; B (newer Dune, 412 pages) joins and sees the prompt. */
async function pairWithDuplicates(a: Page, b: Page): Promise<void> {
  await openApp(a);
  await addDune(a, { logged: 50 });
  await openApp(b);
  await addDune(b, { pages: 412, logged: 100 });

  await a.goto('/#/settings/sync');
  await a.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(a.getByRole('img', { name: 'Sync code QR' })).toBeVisible();
  const code = ((await a.getByTestId('sync-code').textContent()) ?? '').trim();

  await b.goto('/#/settings/sync');
  await b.getByRole('button', { name: 'Join', exact: true }).click();
  await b.getByLabel('Sync code').fill(code);
  await b.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.getByText('1 book may be a duplicate')).toBeVisible({ timeout: 10_000 });
}

async function syncNow(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Sync now' }).first();
  await button.click();
  await expect(button).toBeEnabled();
}

const libraryDunes = async (page: Page) => {
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  return page.getByRole('link', { name: /^Dune/ });
};

const historyCount = async (page: Page): Promise<number> => {
  const dunes = await libraryDunes(page);
  await dunes.first().click();
  const times = page.getByRole('list', { name: 'History' }).locator('time');
  await expect(times.first()).toBeVisible();
  return times.count();
};

test('Review lists the pair side by side; Merge leaves one Dune with all entries and the page count', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  await pairWithDuplicates(a.page, b.page);

  await b.page.getByRole('link', { name: 'Review' }).click();
  await expect(b.page).toHaveURL(/#\/settings\/sync\/duplicates$/);
  const pair = b.page.getByRole('region', { name: 'Duplicate: Dune' });
  await expect(pair.getByText('Kept')).toHaveCount(1);
  await expect(pair.getByText(`ISBN: ${ISBN}`)).toHaveCount(2);
  await expect(pair.getByText('2 entries')).toHaveCount(2);
  await expect(pair.getByText(/^Added /)).toHaveCount(2);
  await pair.getByRole('button', { name: 'Merge' }).click();
  await expect(b.page.getByText('No duplicate books found.')).toBeVisible();

  expect(await (await libraryDunes(b.page)).count()).toBe(1);
  await (await libraryDunes(b.page)).first().click();
  await expect(b.page.getByText('p. 100 / 412')).toBeVisible();
  expect(await historyCount(b.page)).toBe(4);

  // A gets the same result (the survivor is A's older copy, which got the page count).
  await expect(async () => {
    await syncNow(a.page);
    expect(await (await libraryDunes(a.page)).count()).toBe(1);
  }).toPass({ timeout: 20_000 });
  await (await libraryDunes(a.page)).first().click();
  await expect(a.page.getByText('p. 100 / 412')).toBeVisible();
  expect(await historyCount(a.page)).toBe(4);
});

test('Keep both: the pair is not offered again, on either device', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  await pairWithDuplicates(a.page, b.page);
  await b.page.getByRole('link', { name: 'Review' }).click();
  await b.page.getByRole('button', { name: 'Keep both' }).click();
  await expect(b.page.getByText('No duplicate books found.')).toBeVisible();

  await b.page.goto('/#/settings/sync');
  await b.page.getByRole('link', { name: 'Check for duplicates' }).click();
  await expect(b.page.getByText('No duplicate books found.')).toBeVisible();

  await a.page.goto('/#/settings/sync/duplicates');
  await expect(async () => {
    await syncNow(a.page);
    await expect(a.page.getByText('No duplicate books found.')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  expect(await (await libraryDunes(a.page)).count()).toBe(2);
});

test('the same merge on both devices before they sync leaves one Dune with each entry once', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  await pairWithDuplicates(a.page, b.page);
  // Let A receive B's book, then both merge while offline.
  await a.page.goto('/#/settings/sync');
  await expect(async () => {
    await syncNow(a.page);
    await a.page.getByRole('link', { name: 'Check for duplicates' }).click();
    await expect(a.page.getByRole('button', { name: 'Merge' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await a.context.setOffline(true);
  await b.context.setOffline(true);

  await a.page.getByRole('button', { name: 'Merge' }).click();
  await expect(a.page.getByText('No duplicate books found.')).toBeVisible();
  await b.page.getByRole('link', { name: 'Review' }).click();
  await b.page.getByRole('button', { name: 'Merge' }).click();
  await expect(b.page.getByText('No duplicate books found.')).toBeVisible();

  await a.context.setOffline(false);
  await b.context.setOffline(false);
  for (const p of [a.page, b.page, a.page]) {
    await p.goto('/#/');
    await syncNow(p);
  }
  for (const p of [a.page, b.page]) {
    await expect(async () => {
      await syncNow(p);
      expect(await (await libraryDunes(p)).count()).toBe(1);
    }).toPass({ timeout: 20_000 });
    expect(await historyCount(p)).toBe(4);
  }
});
