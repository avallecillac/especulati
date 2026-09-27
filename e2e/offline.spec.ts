import { expect, test } from '@playwright/test';
import { addBook, currentCard, openApp, openLogSheet } from './helpers.ts';

test.describe('US5: installable and fully offline', () => {
  test('after one load, the app starts offline and every flow works (SC-003)', async ({ page, context }) => {
    await openApp(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('ready')).toBeAttached();

    await addBook(page, { title: 'Offline book', pages: 100 });
    const sheet = await openLogSheet(page);
    await sheet.getByLabel('Page', { exact: true }).fill('12');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(currentCard(page).getByText('p. 12 / 100')).toBeVisible();
    const again = await openLogSheet(page);
    await again.getByRole('button', { name: 'Read today' }).click();
    await expect(again).toBeHidden();
  });

  test('data persists after the page is closed and the app reopened', async ({ context }) => {
    const first = await context.newPage();
    await openApp(first);
    await addBook(first, { title: 'Persistent', pages: 200 });
    await first.close();

    const second = await context.newPage();
    await openApp(second);
    await expect(currentCard(second).getByRole('heading', { name: 'Persistent' })).toBeVisible();
  });

  test('the web manifest makes it installable standalone (FR-012)', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as { display: string; icons: { sizes: string }[]; start_url: string };
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  test('the service worker precaches the SQLite wasm (T051)', async ({ request }) => {
    const sw = await (await request.get('/sw.js')).text();
    expect(sw).toMatch(/sqlite3[-\w]*\.wasm/);
  });
});
