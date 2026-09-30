import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/relay.ts';
import { openApp } from './helpers.ts';

/** Seed an article the way the iPhone Shortcut does: through a capture link. */
async function capture(page: Page, o: { url?: string; title?: string; author?: string; words?: number; at?: string } = {}): Promise<void> {
  const json = JSON.stringify({ v: 1, url: 'https://www.example.com/read/essay', title: 'A Long Essay', author: 'Ann Author', words: 2380, at: new Date().toISOString(), ...o });
  await page.goto(`/#/capture?d=${encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'))}`);
  await expect(page.getByText(/^Logged: /)).toBeVisible();
}

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

const rows = (page: Page) => page.getByTestId('article-row');

test('open an article, edit title, author and date read, and see the change', async ({ page }) => {
  await openApp(page);
  await capture(page);
  await openArticles(page);
  await rows(page).getByRole('link', { name: 'A Long Essay' }).click();
  await expect(page.getByRole('heading', { name: 'A Long Essay' })).toBeVisible();
  await expect(page.getByText('Ann Author')).toBeVisible();
  await expect(page.getByText('example.com', { exact: true })).toBeVisible();
  await expect(page.getByText('~10 min')).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Title').fill('A Shorter Essay');
  await page.getByLabel('Author').fill('Bea Writer');
  await page.getByLabel('Date read').fill('2026-02-03');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'A Shorter Essay' })).toBeVisible();
  await expect(page.getByText('Bea Writer')).toBeVisible();
  await expect(page.getByText('Feb 3, 2026')).toBeVisible();

  await openArticles(page);
  await expect(rows(page).first()).toContainText('A Shorter Essay');
  await expect(rows(page).first()).toContainText('2026-02-03');
});

test('Open page opens the address in a new tab, safely', async ({ page }) => {
  await openApp(page);
  await capture(page);
  await openArticles(page);
  await rows(page).getByRole('link', { name: 'A Long Essay' }).click();
  const open = page.getByRole('link', { name: 'Open page' });
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(open).toHaveAttribute('href', 'https://www.example.com/read/essay');
});

test('Remove asks first; the article is gone after confirming', async ({ page }) => {
  await openApp(page);
  await capture(page);
  await openArticles(page);
  await rows(page).getByRole('link', { name: 'A Long Essay' }).click();

  await page.getByRole('button', { name: 'Remove article' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'A Long Essay' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove article' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page).toHaveURL(/#\/articles$/);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('No articles yet.')).toBeVisible();
});

test('Add article: the title is prefilled with the site; details show "Details not fetched" and no time', async ({ page }) => {
  await openApp(page);
  await openArticles(page);
  await page.getByRole('button', { name: 'Add article' }).click();
  await page.getByLabel('Web address').fill('https://www.Example.org/Some/Post?utm_source=x');
  await expect(page.getByLabel('Title')).toHaveValue('example.org');
  await page.getByRole('button', { name: 'Save article' }).click();

  await expect(page.getByRole('heading', { name: 'example.org' })).toBeVisible();
  await expect(page.getByText('Details not fetched')).toBeVisible();
  await expect(page.getByTestId('reading-time')).toHaveText('—');
  await expect(page.getByRole('link', { name: 'Open page' })).toHaveAttribute('href', 'https://www.example.org/Some/Post');
});

test('Add article rejects a bad address and warns about one already logged', async ({ page }) => {
  await openApp(page);
  await capture(page, { at: '2026-03-04T12:00:00Z' });
  await openArticles(page);
  await page.getByRole('button', { name: 'Add article' }).click();

  await page.getByLabel('Web address').fill('ftp://example.com/x');
  await page.getByRole('button', { name: 'Save article' }).click();
  await expect(page.getByText("That isn't a valid web address")).toBeVisible();

  await page.getByLabel('Web address').fill('https://www.example.com/read/essay?fbclid=1');
  await expect(page.getByText(/Already logged on/)).toBeVisible();
  // Only a warning: saving is still allowed.
  await page.getByRole('button', { name: 'Save article' }).click();
  await expect(page.getByRole('heading', { name: 'example.com' })).toBeVisible();
});

test('an edit reaches the second context', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  const code = await turnOn(a.page);
  await join(b.page, code);
  await capture(a.page);
  await syncNow(b.page);
  await openArticles(b.page);
  await expect(rows(b.page)).toHaveCount(1);

  await openArticles(a.page);
  await rows(a.page).getByRole('link', { name: 'A Long Essay' }).click();
  await a.page.getByRole('button', { name: 'Edit' }).click();
  await a.page.getByLabel('Title').fill('Edited on A');
  await a.page.getByRole('button', { name: 'Save' }).click();
  await expect(a.page.getByRole('heading', { name: 'Edited on A' })).toBeVisible();
  await syncNow(a.page);

  await syncNow(b.page);
  await openArticles(b.page);
  await expect(rows(b.page).first()).toContainText('Edited on A');
});
