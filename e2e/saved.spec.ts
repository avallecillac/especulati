import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.ts';

const rows = (page: Page) => page.getByTestId('saved-row');
const savedTab = (page: Page) => page.getByRole('tab', { name: 'Saved' });

/** "Mar 4, 2026" for today in the test time zone, the format the app shows. */
const todayLong = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });

async function openSaved(page: Page): Promise<void> {
  await page.goto('/#/library');
  await savedTab(page).click();
}

/** Add an article by address with Read later ticked. */
async function saveLater(page: Page, url: string, title?: string): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Articles' }).click();
  await page.getByRole('button', { name: 'Add article' }).click();
  await page.getByLabel('Web address').fill(url);
  if (title) await page.getByLabel('Title').fill(title);
  await page.getByLabel('Read later').check();
  await page.getByRole('button', { name: 'Save article' }).click();
  await expect(rows(page).filter({ hasText: title ?? new URL(url).hostname })).toHaveCount(1);
}

test('Add article with Read later lands in Saved, not Articles, and the tab shows the count', async ({ page }) => {
  await openApp(page);
  await page.goto('/#/library');
  await expect(savedTab(page)).toHaveText('Saved');
  await saveLater(page, 'https://www.example.com/read/essay', 'A Long Essay');
  await expect(page.getByRole('tab', { name: 'Saved' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Saved' })).toContainText('1');
  await page.getByRole('tab', { name: 'Articles' }).click();
  await expect(page.getByTestId('article-row')).toHaveCount(0);
  await expect(page.getByText('A Long Essay')).toHaveCount(0);
});

test('rows are newest first and show title, site and Saved date; tapping opens a new tab', async ({ page }) => {
  await openApp(page);
  await saveLater(page, 'https://www.example.com/first', 'First saved');
  await saveLater(page, 'https://blog.example.org/second', 'Second saved');
  await openSaved(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText('Second saved');
  await expect(rows(page).nth(1)).toContainText('First saved');
  await expect(rows(page).nth(0)).toContainText('blog.example.org');
  await expect(rows(page).nth(0)).toContainText(`Saved ${todayLong()}`);

  const link = rows(page).nth(0).getByRole('link', { name: 'Second saved' });
  await expect(link).toHaveAttribute('href', 'https://blog.example.org/second');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const popup = page.context().waitForEvent('page');
  await link.click();
  await (await popup).close();
});

test('Remove takes the row off the list and the count', async ({ page }) => {
  await openApp(page);
  await saveLater(page, 'https://www.example.com/a', 'Keep me');
  await saveLater(page, 'https://www.example.com/b', 'Drop me');
  await openSaved(page);
  await rows(page).filter({ hasText: 'Drop me' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Keep me');
  await expect(savedTab(page)).toContainText('1');
});

test('Remove shows a toast whose Undo puts the row back', async ({ page }) => {
  await openApp(page);
  await saveLater(page, 'https://www.example.com/a', 'Keep me');
  await saveLater(page, 'https://www.example.com/b', 'Drop me');
  await openSaved(page);
  await rows(page).filter({ hasText: 'Drop me' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).filter({ hasText: 'Drop me' })).toHaveCount(1);
  await expect(savedTab(page)).toContainText('2');
});

test('the empty state shows the vignette and the hint', async ({ page }) => {
  await openApp(page);
  await openSaved(page);
  await expect(page.getByText('Nothing saved yet. Save articles to read them later.')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});

test('saving for later changes nothing in Stats (SC-003)', async ({ page }) => {
  await openApp(page);
  const logged = JSON.stringify({ v: 1, url: 'https://example.com/read', title: 'Read one', words: 2380, at: new Date().toISOString() });
  await page.goto(`/#/capture?d=${encodeURIComponent(Buffer.from(logged, 'utf8').toString('base64'))}`);
  await expect(page.getByText(/^Logged: /)).toBeVisible();

  const stats = async () => {
    await page.goto('/#/stats');
    const section = page.getByRole('region', { name: 'Articles' });
    await expect(section).toBeVisible();
    return await section.innerText();
  };
  const before = await stats();
  await saveLater(page, 'https://www.example.com/later', 'Later one');
  await saveLater(page, 'https://other.example.net/later2', 'Later two');
  expect(await stats()).toBe(before);
});

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

async function statsText(page: Page): Promise<string> {
  await page.goto('/#/stats');
  const section = page.getByRole('region', { name: 'Articles' });
  await expect(section).toBeVisible();
  return await section.innerText();
}

test('Mark as read moves the article to Articles dated today, counts in Stats, and Undo puts it back', async ({ page }) => {
  await openApp(page);
  await saveLater(page, 'https://www.example.com/later', 'Later one');
  const before = await statsText(page);
  await openSaved(page);
  await rows(page).first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as read' }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Marked as read');

  // Undo while the toast is up: back in Saved, not in Articles.
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(rows(page).filter({ hasText: 'Later one' })).toHaveCount(1);
  await page.getByRole('tab', { name: 'Articles' }).click();
  await expect(page.getByTestId('article-row')).toHaveCount(0);
  expect(await statsText(page)).toBe(before);

  // Mark as read again and keep it.
  await openSaved(page);
  await rows(page).first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as read' }).click();
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Articles' }).click();
  await expect(page.getByTestId('article-row')).toHaveCount(1);
  await expect(page.getByTestId('article-row').first()).toContainText('Later one');
  await expect(page.getByTestId('article-row').first()).toContainText(todayIso());
  expect(await statsText(page)).not.toBe(before);
});

test('the Article screen of a saved article shows Saved <date> and a Mark as read button', async ({ page }) => {
  await openApp(page);
  await saveLater(page, 'https://www.example.com/later', 'Later one');
  await openSaved(page);
  await rows(page).first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Details' }).click();
  await expect(page.getByRole('heading', { name: 'Later one' })).toBeVisible();
  await expect(page.getByText(`Saved ${todayLong()}`)).toBeVisible();
  await expect(page.getByText('Read on', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
  await expect(page.getByText('Read on', { exact: true })).toBeVisible();
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(`Saved ${todayLong()}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible();
});

test('Add highlight on a saved article marks it read and keeps the highlight (FR-006)', async ({ page }) => {
  await openApp(page);
  await saveLater(page, 'https://www.example.com/later', 'Later one');
  await openSaved(page);
  await rows(page).first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Details' }).click();
  await page.getByRole('button', { name: 'Add highlight' }).click();
  await page.getByRole('dialog').getByLabel('Quote').fill('A passage worth keeping.');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('article', { name: 'Highlight' })).toHaveCount(1);
  await expect(page.getByText('Read on', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
  await openSaved(page);
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Articles' }).click();
  await expect(page.getByTestId('article-row')).toHaveCount(1);
});

test('removing a saved article from its screen shows Undo, which restores it', async ({ page }) => {
  await openApp(page);
  await saveLater(page, 'https://www.example.com/later', 'Later one');
  await openSaved(page);
  await rows(page).first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Details' }).click();
  await page.getByRole('button', { name: 'Remove article' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await openSaved(page);
  await expect(rows(page)).toHaveCount(1);
});
