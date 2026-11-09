import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/relay.ts';
import { openApp } from './helpers.ts';

/** Build the link the way the Save to Readerlog Shortcut does: JSON with `later: 1` → Base64 → URL-encode. */
function link(o: Record<string, unknown> = {}, at = new Date().toISOString()): string {
  const json = JSON.stringify({ v: 1, url: 'https://www.example.com/read/essay?utm_source=x', title: 'A Long Essay', author: 'Ann Author', words: 2380, at, later: 1, ...o });
  const b64 = Buffer.from(json, 'utf8').toString('base64').replace(/(.{76})/g, '$1\n');
  return `#/capture?d=${encodeURIComponent(b64)}`;
}

const savedRows = (page: Page) => page.getByTestId('saved-row');
const articleRows = (page: Page) => page.getByTestId('article-row');

async function openSaved(page: Page): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Saved' }).click();
}

async function turnOn(page: Page): Promise<string> {
  await openApp(page, '#/settings/sync');
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(page.getByRole('img', { name: 'Sync code QR' })).toBeVisible();
  return ((await page.getByTestId('sync-code').textContent()) ?? '').trim();
}

async function join(page: Page, code: string): Promise<void> {
  await openApp(page, '#/settings/sync');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.getByLabel('Sync code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show code' })).toBeVisible({ timeout: 10_000 });
}

async function syncNow(page: Page): Promise<void> {
  await page.goto('/#/');
  const button = page.getByRole('button', { name: 'Sync now' });
  await button.click();
  await expect(button).toBeEnabled();
}

test('a later link saves, shows Saved for later with Undo, and reopening says Already saved', async ({ page }) => {
  await openApp(page);
  const first = link({}, '2026-03-04T12:00:00Z');
  await page.goto(`/${first}`);
  await expect(page.getByText('Saved for later')).toBeVisible();
  await expect(page.getByText('A Long Essay · example.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await openSaved(page);
  await expect(savedRows(page)).toHaveCount(1);
  await page.getByRole('tab', { name: 'Articles' }).click();
  await expect(articleRows(page)).toHaveCount(0);

  await page.goto(`/${first}`);
  await page.reload();
  await expect(page.getByText('Already saved')).toBeVisible();
  await openSaved(page);
  await expect(savedRows(page)).toHaveCount(1);
});

test('Undo removes the saved entry', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${link({}, '2026-03-05T12:00:00Z')}`);
  await expect(page.getByText('Saved for later')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Removed')).toBeVisible();
  await openSaved(page);
  await expect(savedRows(page)).toHaveCount(0);
});

test('a URL that was already read gets a new saved entry and the screen says when you read it', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${link({ later: undefined }, '2026-03-04T12:00:00Z')}`);
  await expect(page.getByText(/^Logged: /)).toBeVisible();
  await page.goto(`/${link({}, '2026-03-06T12:00:00Z')}`);
  await expect(page.getByText('Saved for later')).toBeVisible();
  await expect(page.getByText(/You read this on [A-Z][a-z]{2} \d{1,2}, \d{4}/)).toBeVisible();
  await openSaved(page);
  await expect(savedRows(page)).toHaveCount(1);
  await page.getByRole('tab', { name: 'Articles' }).click();
  await expect(articleRows(page)).toHaveCount(1);
});

test('a quote wins over later: it is a highlight capture', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${link({ quote: 'A passage.' }, '2026-03-07T12:00:00Z')}`);
  await expect(page.getByText('Highlight saved')).toBeVisible();
  await openSaved(page);
  await expect(savedRows(page)).toHaveCount(0);
});

test('offline it saves locally, then syncs to the other device', async ({ twoDevices, relay }) => {
  const { a, b } = twoDevices;
  const code = await turnOn(a.page);
  await join(b.page, code);
  await a.page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await a.page.goto('/#/');
  await a.context.setOffline(true);
  await a.page.reload();
  await expect(a.page.getByTestId('ready')).toBeAttached();
  await a.page.goto(`/${link({}, '2026-03-08T12:00:00Z')}`);
  await expect(a.page.getByText('Saved for later')).toBeVisible();
  await a.context.setOffline(false);
  await syncNow(a.page);
  await syncNow(b.page);
  await openSaved(b.page);
  await expect(savedRows(b.page)).toHaveCount(1);
  await expect(savedRows(b.page).first()).toContainText('A Long Essay');
  expect(relay.requests().length).toBeGreaterThan(0);
});
