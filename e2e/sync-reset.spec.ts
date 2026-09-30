import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/relay.ts';
import { addBook, openApp } from './helpers.ts';

/** A adds "Dune" and turns sync on; B joins. Returns the sync code. */
async function pair(a: Page, b: Page): Promise<string> {
  await openApp(a);
  await addBook(a, { title: 'Dune', pages: 300 });
  await a.goto('/#/settings/sync');
  await a.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(a.getByRole('img', { name: 'Sync code QR' })).toBeVisible();
  const code = ((await a.getByTestId('sync-code').textContent()) ?? '').trim();

  await openApp(b, '#/settings/sync');
  await b.getByRole('button', { name: 'Join', exact: true }).click();
  await b.getByLabel('Sync code').fill(code);
  await b.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Show code' })).toBeVisible({ timeout: 10_000 });
  await b.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(b.getByRole('link', { name: 'Dune' })).toBeVisible({ timeout: 10_000 });
  return code;
}

const titlesIn = async (page: Page) => {
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  return page.getByRole('link').filter({ hasText: /^(Dune|Emma|Ulysses)/ }).allInnerTexts();
};

test('leave: the device keeps its books and stops syncing', async ({ twoDevices, relay }) => {
  const { a, b } = twoDevices;
  await pair(a.page, b.page);

  await a.page.goto('/#/settings/sync');
  await a.page.getByRole('button', { name: 'Leave sync space' }).click();
  const dialog = a.page.getByRole('alertdialog', { name: 'Leave sync space?' });
  await expect(dialog).toContainText('This device will stop syncing. Its data stays here.');
  await dialog.getByRole('button', { name: 'Leave' }).click();
  await expect(a.page.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Sync now' })).toHaveCount(0); // top bar button is gone too

  await a.page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(a.page.getByRole('link', { name: 'Dune' })).toBeVisible();

  // A's later changes never reach B, and A makes no relay calls.
  const before = relay.requests().length;
  await addBook(a.page, { title: 'Emma', pages: 200 });
  await a.page.waitForTimeout(3500);
  expect(relay.requests().length).toBe(before);
  await b.page.getByRole('link', { name: 'Home', exact: true }).click();
  await b.page.getByRole('button', { name: 'Sync now' }).click();
  await expect(b.page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  await b.page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(b.page.getByRole('link', { name: 'Dune' })).toBeVisible();
  await expect(b.page.getByRole('link', { name: 'Emma' })).toHaveCount(0);
});

test('reset: a new code, the other device is told to rejoin, and after joining both show the union', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  const oldCode = await pair(a.page, b.page);

  // B adds a book that only B has, then A resets the space.
  await addBook(b.page, { title: 'Ulysses', pages: 700 });
  await a.page.goto('/#/settings/sync');
  await a.page.getByRole('button', { name: 'Reset sync' }).click();
  const dialog = a.page.getByRole('alertdialog', { name: 'Reset sync?' });
  await expect(dialog).toContainText('Creates a new sync code and deletes the old space. Your other devices must join again with the new code.');
  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(a.page.getByRole('img', { name: 'Sync code QR' })).toBeVisible({ timeout: 10_000 });
  await expect(a.page.getByTestId('sync-code')).not.toHaveText(oldCode, { timeout: 10_000 });
  const newCode = ((await a.page.getByTestId('sync-code').textContent()) ?? '').trim();

  // B is told, and keeps its data.
  await b.page.goto('/#/settings/sync');
  await b.page.getByRole('button', { name: 'Sync now', exact: true }).last().click();
  await expect(b.page.getByTestId('sync-status')).toContainText('This sync space no longer exists. Rejoin with a new code.', { timeout: 10_000 });
  await b.page.getByRole('button', { name: 'Join with a new code' }).click();
  await b.page.getByLabel('Sync code').fill(newCode);
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.page.getByRole('button', { name: 'Show code' })).toBeVisible({ timeout: 10_000 });
  await expect(b.page.getByTestId('sync-status')).not.toContainText('no longer exists');

  // Both show the union.
  await a.page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(async () => {
    await a.page.getByRole('button', { name: 'Sync now' }).click();
    await expect(a.page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
    expect((await titlesIn(a.page)).length).toBe(2);
  }).toPass({ timeout: 15_000 });
  expect((await titlesIn(b.page)).length).toBe(2);
});
