import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/relay.ts';
import { openApp } from './helpers.ts';

/** Build the link the way the iPhone Shortcut does: JSON → Base64 (line breaks every 76 chars) → URL-encode. */
function captureLink(o: Record<string, unknown>, at = new Date().toISOString()): string {
  const json = JSON.stringify({ v: 1, url: 'https://www.example.com/read/essay?utm_source=x', title: 'A Long Essay', author: 'Ann Author', words: 2380, at, ...o });
  const b64 = Buffer.from(json, 'utf8').toString('base64').replace(/(.{76})/g, '$1\n');
  return `#/capture?d=${encodeURIComponent(b64)}`;
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const rows = (page: Page) => page.getByTestId('article-row');

async function openArticles(page: Page): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Articles' }).click();
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

test('a valid link logs the article, dated today; a reload says already saved; Undo removes it', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${captureLink({})}`);
  await expect(page.getByText('Logged: A Long Essay · example.com · ~10 min')).toBeVisible();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('A Long Essay');
  await expect(rows(page).first()).toContainText(today());

  // The same link again (a reload) does not save twice.
  const link = captureLink({ url: 'https://www.example.com/read/two' }, '2026-03-04T12:00:00Z');
  await page.goto(`/${link}`);
  await expect(page.getByText('Logged: A Long Essay')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Already saved')).toBeVisible();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(2);

  // Undo removes the article.
  await page.goto(`/${captureLink({ url: 'https://other.example.org/x' }, '2026-03-05T12:00:00Z')}`);
  await expect(page.getByText('Logged: A Long Essay · other.example.org')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText('other.example.org')).toHaveCount(0);
});

test('a damaged link saves nothing and offers Add article', async ({ page }) => {
  await openApp(page);
  for (const bad of ['#/capture?d=%%%', '#/capture', `#/capture?d=${encodeURIComponent(Buffer.from('{"v":2}').toString('base64'))}`]) {
    await page.goto(`/${bad}`);
    await expect(page.getByText('This capture link is damaged')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add article' })).toBeVisible();
  }
  // A date without a time, as Format Date gives with Include ISO 8601 Time off.
  const dateOnly = { v: 1, url: 'https://example.com/a', at: '2026-09-30' };
  await page.goto(`/#/capture?d=${encodeURIComponent(Buffer.from(JSON.stringify(dateOnly)).toString('base64'))}`);
  await expect(page.getByText('This capture link is damaged')).toBeVisible();
  await expect(page.getByText('turn on Include ISO 8601 Time')).toBeVisible();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(0);
});

test('an already-logged URL asks first: Cancel adds nothing, Log again adds another', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${captureLink({}, '2026-03-04T12:00:00Z')}`);
  await expect(page.getByText('Logged: A Long Essay')).toBeVisible();

  await page.goto(`/${captureLink({}, '2026-03-06T12:00:00Z')}`);
  await expect(page.getByText(/Already logged on/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(1);

  await page.goto(`/${captureLink({}, '2026-03-06T12:00:00Z')}`);
  await page.getByRole('button', { name: 'Log again' }).click();
  await expect(page.getByText('Logged: A Long Essay')).toBeVisible();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(2);
});

test('with sync on, the capture is pushed at once and reaches the other device', async ({ twoDevices, relay }) => {
  const { a, b } = twoDevices;
  const code = await turnOn(a.page);
  await join(b.page, code);

  const before = relay.requests().filter((r) => r.startsWith('POST')).length;
  await a.page.goto(`/${captureLink({})}`);
  await expect(a.page.getByText('Logged: A Long Essay')).toBeVisible();
  // Well under the 3 s write debounce.
  await expect.poll(() => relay.requests().filter((r) => r.startsWith('POST')).length, { timeout: 2_000 }).toBeGreaterThan(before);
  await expect(a.page.getByText(/Finish setup/)).toHaveCount(0);

  await syncNow(b.page);
  await openArticles(b.page);
  await expect(rows(b.page)).toHaveCount(1);
  await expect(rows(b.page).first()).toContainText('A Long Essay');
});

test('with sync off, it is saved and a Finish setup prompt is shown', async ({ page, relay }) => {
  await openApp(page);
  await page.goto(`/${captureLink({})}`);
  await expect(page.getByText('Logged: A Long Essay')).toBeVisible();
  await expect(page.getByText(/Finish setup/)).toBeVisible();
  await page.getByRole('link', { name: /join your sync space/i }).click();
  await expect(page).toHaveURL(/#\/settings\/sync$/);
  await openArticles(page);
  await expect(rows(page)).toHaveCount(1);
  expect(relay.requests()).toEqual([]);
});

test('offline: saved locally, and the other device has it after going online and a sync', async ({ twoDevices }) => {
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
  await a.page.goto(`/${captureLink({})}`);
  await expect(a.page.getByText('Logged: A Long Essay')).toBeVisible();
  await openArticles(a.page);
  await expect(rows(a.page)).toHaveCount(1);

  await a.context.setOffline(false);
  await syncNow(a.page);
  await syncNow(b.page);
  await openArticles(b.page);
  await expect(rows(b.page)).toHaveCount(1);
  await expect(rows(b.page).first()).toContainText('A Long Essay');
});
