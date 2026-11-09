import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/relay.ts';
import { openApp } from './helpers.ts';

// Feature 008 US2 (research R4): a URL saved on one device and logged on another becomes one article.
const URL_ = 'https://www.example.com/read/essay';
const QUOTE = 'It was the best of times, it was the worst of times.';

/** The link the iPhone Shortcut builds: JSON → Base64 → URL-encode. */
function link(o: Record<string, unknown>, at = new Date().toISOString()): string {
  const json = JSON.stringify({ v: 1, url: URL_ + '?utm_source=x', title: 'A Long Essay', author: 'Ann Author', words: 2380, at, ...o });
  const b64 = Buffer.from(json, 'utf8').toString('base64').replace(/(.{76})/g, '$1\n');
  return `#/capture?d=${encodeURIComponent(b64)}`;
}

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

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

/** Exactly one live article: none saved, one read today, holding the highlight. */
async function expectMerged(page: Page): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Saved' }).click();
  await expect(page.getByTestId('saved-row')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Articles' }).click();
  await expect(page.getByTestId('article-row')).toHaveCount(1);
  await expect(page.getByTestId('article-row').first()).toContainText(todayIso());
  await page.getByTestId('article-row').first().getByRole('link').first().click();
  await expect(page.getByRole('article', { name: 'Highlight' })).toHaveCount(1);
  await expect(page.getByText(QUOTE)).toBeVisible();
  // SC-002: the tag A put on the saved copy survives the merge.
  await expect(page.getByRole('button', { name: 'Remove tag ai', exact: true })).toBeVisible();
}

/** Tag the saved copy "ai" through its screen (Saved → More → Details). */
async function tagSaved(page: Page): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Saved' }).click();
  await page.getByTestId('saved-row').first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Details' }).click();
  const input = page.getByRole('combobox', { name: 'Add tag', exact: true });
  await input.fill('ai');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove tag ai', exact: true })).toBeVisible();
}

test('a URL saved on one device and logged on another merges into one read article with the highlight (SC-002)', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  // A saves first, then B logs the same URL as read with a highlight; neither has synced yet.
  await openApp(a.page);
  await a.page.goto(`/${link({ later: 1 })}`);
  await expect(a.page.getByText('Saved for later')).toBeVisible();
  await tagSaved(a.page);
  await openApp(b.page);
  await b.page.goto(`/${link({ quote: QUOTE })}`);
  await expect(b.page.getByText('Highlight saved')).toBeVisible();

  const code = await turnOn(a.page);
  await join(b.page, code);
  await syncNow(a.page);
  await syncNow(b.page);
  await syncNow(a.page);
  await syncNow(b.page);

  await expectMerged(a.page);
  await expectMerged(b.page);
});
