import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/relay.ts';
import { openApp } from './helpers.ts';

// Feature 007 US2: the capture link with a quote (contracts/capture-highlight.md).
const URL_ = 'https://www.example.com/read/essay';
const QUOTE = 'It was the best of times, it was the worst of times.';

/** The link the iPhone Shortcut builds: JSON → Base64 (line breaks every 76 chars) → URL-encode. */
function link(o: Record<string, unknown>, at = new Date().toISOString()): string {
  const json = JSON.stringify({ v: 1, url: URL_ + '?utm_source=x', title: 'A Long Essay', author: 'Ann Author', words: 2380, at, quote: QUOTE, ...o });
  const b64 = Buffer.from(json, 'utf8').toString('base64').replace(/(.{76})/g, '$1\n');
  return `#/capture?d=${encodeURIComponent(b64)}`;
}

const rows = (page: Page) => page.getByTestId('article-row');
const entries = (page: Page) => page.getByRole('article', { name: /^(Highlight|Note)$/ });

async function openArticles(page: Page): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Articles' }).click();
}

/** The article's own screen, through the Articles list. */
async function openFirstArticle(page: Page): Promise<void> {
  await openArticles(page);
  await rows(page).first().getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Highlights' })).toBeVisible();
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

test('a link with a quote for a new URL logs the article and shows the highlight; a reload says Already saved', async ({ page }) => {
  await openApp(page);
  const l = link({}, '2026-03-04T12:00:00Z');
  await page.goto(`/${l}`);
  await expect(page.getByText('Highlight saved')).toBeVisible();
  await expect(page.getByText(QUOTE)).toBeVisible();
  await expect(page.getByText('A Long Essay · example.com')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Already saved')).toBeVisible();
  await expect(page.getByText(QUOTE)).toBeVisible();

  await openFirstArticle(page);
  await expect(rows(page)).toHaveCount(0);
  await expect(entries(page)).toHaveCount(1);
  await openArticles(page);
  await expect(rows(page)).toHaveCount(1);
});

test('an already-logged URL gets a highlight with no duplicate prompt, and no second article', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${link({ quote: undefined }, '2026-03-04T12:00:00Z')}`);
  await expect(page.getByText('Logged: A Long Essay')).toBeVisible();

  await page.goto(`/${link({}, '2026-03-06T12:00:00Z')}`);
  await expect(page.getByText('Highlight saved')).toBeVisible();
  await expect(page.getByText(/Already logged on/)).toHaveCount(0);
  await openArticles(page);
  await expect(rows(page)).toHaveCount(1);
  await openFirstArticle(page);
  await expect(entries(page)).toHaveCount(1);

  // Undo of a highlight on a pre-existing article keeps the article.
  await page.goto(`/${link({ quote: 'Another passage.' }, '2026-03-07T12:00:00Z')}`);
  await page.getByRole('button', { name: 'Undo' }).click();
  await openFirstArticle(page);
  await expect(entries(page)).toHaveCount(1);
});

test('Add note saves the note on the highlight', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${link({}, '2026-03-04T12:00:00Z')}`);
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.getByLabel('Note').fill('Opening line, remember it.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Opening line, remember it.')).toBeVisible();
  await openFirstArticle(page);
  await expect(entries(page)).toHaveCount(1);
  await expect(page.getByText('Opening line, remember it.')).toBeVisible();
});

test('Undo removes the highlight and, because this link created it, the article', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${link({}, '2026-03-04T12:00:00Z')}`);
  await expect(page.getByText('Highlight saved')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Removed')).toBeVisible();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(0);
});

test('a link whose article was removed logs it anew', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${link({}, '2026-03-04T12:00:00Z')}`);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Removed')).toBeVisible();
  await page.goto(`/${link({}, '2026-03-05T12:00:00Z')}`);
  await expect(page.getByText('Highlight saved')).toBeVisible();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(1);
});

test('a 5,001-character quote saves nothing and names the problem', async ({ page }) => {
  await openApp(page);
  await page.goto(`/${link({ quote: 'x'.repeat(5001) })}`);
  await expect(page.getByText('This capture link is damaged')).toBeVisible();
  await expect(page.getByText('The passage is too long (5,000 characters max).')).toBeVisible();
  await openArticles(page);
  await expect(rows(page)).toHaveCount(0);
});

test('with sync on, the highlight is pushed at once; offline it is saved locally and syncs later', async ({ twoDevices, relay }) => {
  const { a, b } = twoDevices;
  const code = await turnOn(a.page);
  await join(b.page, code);
  await a.page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const before = relay.requests().filter((r) => r.startsWith('POST')).length;
  await a.page.goto(`/${link({}, '2026-03-04T12:00:00Z')}`);
  await expect(a.page.getByText('Highlight saved')).toBeVisible();
  await expect.poll(() => relay.requests().filter((r) => r.startsWith('POST')).length, { timeout: 2_000 }).toBeGreaterThan(before);
  await expect(a.page.getByText(/Finish setup/)).toHaveCount(0);

  await a.page.goto('/#/');
  await a.context.setOffline(true);
  await a.page.reload();
  await expect(a.page.getByTestId('ready')).toBeAttached();
  await a.page.goto(`/${link({ quote: 'Saved while offline.' }, '2026-03-05T12:00:00Z')}`);
  await expect(a.page.getByText('Highlight saved')).toBeVisible();
  await a.context.setOffline(false);
  await syncNow(a.page);
  await syncNow(b.page);
  await openFirstArticle(b.page);
  await expect(entries(b.page)).toHaveCount(2);
  await expect(b.page.getByText('Saved while offline.')).toBeVisible();
});

test('with sync off, the Finish setup prompt is shown', async ({ page, relay }) => {
  await openApp(page);
  await page.goto(`/${link({})}`);
  await expect(page.getByText('Highlight saved')).toBeVisible();
  await expect(page.getByText(/Finish setup/)).toBeVisible();
  expect(relay.requests()).toEqual([]);
});
