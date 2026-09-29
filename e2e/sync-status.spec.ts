import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/relay.ts';
import { addBook, currentCard, openApp, openLogSheet } from './helpers.ts';

/** Add "Dune", turn sync on, and land on the Sync screen. */
async function syncedDevice(page: Page): Promise<void> {
  await openApp(page);
  await addBook(page, { title: 'Dune', pages: 300 });
  await page.goto('/#/settings/sync');
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(page.getByRole('img', { name: 'Sync code QR' })).toBeVisible();
}

async function logPage(page: Page, n: number): Promise<void> {
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  const sheet = await openLogSheet(page);
  await sheet.getByLabel('Page', { exact: true }).fill(String(n));
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
}

const status = (page: Page) => page.getByTestId('sync-status');

test('3 changes made offline are counted; after syncing it is Last synced: just now and 0 waiting', async ({ page }) => {
  await syncedDevice(page);
  await page.context().setOffline(true);
  await logPage(page, 10);
  await logPage(page, 20);
  await logPage(page, 30);

  await page.goto('/#/settings/sync');
  await expect(status(page)).toContainText('3 changes waiting to sync');
  await expect(status(page)).toContainText('Offline — changes will be sent later', { timeout: 10_000 });

  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sync now', exact: true }).last().click();
  await expect(status(page)).toContainText('Last synced: just now', { timeout: 10_000 });
  await expect(status(page)).toContainText('0 changes waiting');
  await expect(status(page)).not.toContainText('Offline');
});

test('Sync now runs a sync: the relay sees more requests', async ({ page, relay }) => {
  await syncedDevice(page);
  await expect(status(page)).toContainText('Last synced');
  const before = relay.requests().length;
  await page.getByRole('button', { name: 'Sync now', exact: true }).last().click();
  await expect.poll(() => relay.requests().length).toBeGreaterThan(before);
});

test('a relay 404 says the space is gone, and the app still works', async ({ page, relay }) => {
  await syncedDevice(page);
  relay.failWith(404);
  await page.getByRole('button', { name: 'Sync now', exact: true }).last().click();
  await expect(status(page)).toContainText('This sync space no longer exists. Rejoin with a new code.', { timeout: 10_000 });

  await page.goto('/#/settings');
  await expect(page.getByTestId('settings-sync-status')).toContainText('This sync space no longer exists');
  await addBook(page, { title: 'Emma', pages: 200 });
  await expect(currentCard(page).getByRole('heading', { name: 'Emma' })).toBeVisible();
});
