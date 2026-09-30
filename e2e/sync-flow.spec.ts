import type { Page } from '@playwright/test';
import { test, expect, type RelayFixture } from './fixtures/relay.ts';
import { addBook, currentCard, openApp, openLogSheet } from './helpers.ts';

/** A adds "Dune" (300 pages, reading), turns sync on; B joins. Both end on Home, no reload afterwards. */
async function pair(a: Page, b: Page): Promise<void> {
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

  for (const p of [a, b]) {
    await p.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(currentCard(p).getByRole('heading', { name: 'Dune' })).toBeVisible({ timeout: 10_000 });
    await expect(p.getByRole('button', { name: 'Sync now' })).toBeVisible();
  }
}

const pushes = (relay: RelayFixture) => relay.requests().filter((r) => r.startsWith('POST')).length;

async function logPage(page: Page, n: number, day?: 'Yesterday'): Promise<void> {
  const sheet = await openLogSheet(page);
  if (day) await sheet.getByRole('button', { name: day }).click();
  await sheet.getByLabel('Page', { exact: true }).fill(String(n));
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
}

/** Tap the sync button on `page` and wait for the run to finish. */
async function tapSync(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Sync now' });
  await button.click();
  await expect(button).toBeEnabled();
}

const historyDates = (page: Page) => page.getByRole('list', { name: 'History' }).locator('time').evaluateAll((els) => els.map((e) => e.getAttribute('datetime')));

test('log on A: B shows it after visibilitychange and after tapping Sync now, no reload', async ({ twoDevices, relay }) => {
  const { a, b } = twoDevices;
  await pair(a.page, b.page);

  const before = pushes(relay);
  await logPage(a.page, 120);
  // The write trigger pushes about 3 s later.
  await expect.poll(() => pushes(relay), { timeout: 10_000 }).toBeGreaterThan(before);

  await b.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(currentCard(b.page).getByText('p. 120 / 300')).toBeVisible({ timeout: 10_000 });

  const mid = pushes(relay);
  await logPage(a.page, 150);
  await expect.poll(() => pushes(relay), { timeout: 10_000 }).toBeGreaterThan(mid);
  await tapSync(b.page);
  await expect(currentCard(b.page).getByText('p. 150 / 300')).toBeVisible({ timeout: 10_000 });
});

test('offline entries, one dated Yesterday, arrive with their original dates', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  await pair(a.page, b.page);

  await a.context.setOffline(true);
  await logPage(a.page, 10);
  await logPage(a.page, 20, 'Yesterday');
  await logPage(a.page, 30);
  await a.context.setOffline(false);

  await expect(currentCard(b.page).getByText('p. 30 / 300')).toBeHidden();
  await expect(async () => {
    await tapSync(b.page);
    await expect(currentCard(b.page).getByText('p. 30 / 300')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await a.page.getByRole('link', { name: 'Library', exact: true }).click();
  await a.page.getByRole('link', { name: 'Dune' }).click();
  await b.page.getByRole('link', { name: 'Library', exact: true }).click();
  await b.page.getByRole('link', { name: 'Dune' }).click();
  const onA = await historyDates(a.page);
  expect(onA).toHaveLength(4);
  await expect.poll(() => historyDates(b.page)).toEqual(onA);
  expect(new Set(onA).size).toBe(2);
});

test('concurrent edits made offline merge: both devices show both', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  await pair(a.page, b.page);
  await a.context.setOffline(true);
  await b.context.setOffline(true);

  for (const [p, edit] of [
    [a.page, async () => a.page.getByLabel('Title').fill('Dune Messiah')],
    [b.page, async () => b.page.getByLabel('Total pages').fill('350')],
  ] as const) {
    await p.getByRole('link', { name: 'Library', exact: true }).click();
    await p.getByRole('link', { name: 'Dune' }).click();
    await p.getByRole('button', { name: 'Edit' }).click();
    await edit();
    await p.getByRole('button', { name: 'Save book' }).click();
    await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
  }

  await a.context.setOffline(false);
  await b.context.setOffline(false);
  for (const p of [a.page, b.page]) {
    await p.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(async () => {
      await tapSync(p);
      await expect(currentCard(p).getByRole('heading', { name: 'Dune Messiah' })).toBeVisible({ timeout: 1000 });
      await expect(currentCard(p).getByText('350 pages')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
  }
});

test('removing a book on A removes it on B', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  await pair(a.page, b.page);

  await a.page.getByRole('link', { name: 'Library', exact: true }).click();
  await a.page.getByRole('link', { name: 'Dune' }).click();
  await a.page.getByRole('button', { name: 'Remove book' }).click();
  await a.page.getByRole('alertdialog', { name: 'Remove this book?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(a.page).toHaveURL(/#\/library$/);

  await expect(async () => {
    await tapSync(b.page);
    await expect(currentCard(b.page)).toBeHidden({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await b.page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(b.page.getByRole('link', { name: 'Dune' })).toHaveCount(0);
});

test('relay down: no error dialog, the app keeps working (SC-006)', async ({ twoDevices, relay }) => {
  const { a, b } = twoDevices;
  await pair(a.page, b.page);
  relay.failWith(503);

  await addBook(a.page, { title: 'Emma', pages: 200 });
  await logPage(a.page, 5);
  await a.page.waitForTimeout(3500); // the write trigger fires and fails
  await tapSync(a.page);

  await expect(a.page.getByRole('dialog')).toHaveCount(0);
  await expect(a.page.getByRole('alertdialog')).toHaveCount(0);
  await expect(a.page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(currentCard(a.page).getByText('p. 5 / 200')).toBeVisible();
  void b;
});
