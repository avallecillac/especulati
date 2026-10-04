import { test, expect, type Page } from '@playwright/test';
import { openApp } from './helpers.ts';

// Feature 007 US3/US4: the article screen's highlights list (contracts/ui-highlights.md).
const URL_ = 'https://www.example.com/read/essay';

async function openArticle(page: Page): Promise<void> {
  await openApp(page);
  await page.goto('/#/articles');
  await page.getByRole('button', { name: 'Add article' }).click();
  await page.getByLabel('Web address').fill(URL_);
  await page.getByRole('button', { name: 'Save article' }).click();
  await expect(page.getByRole('heading', { name: 'example.com' })).toBeVisible();
}

const sheet = (page: Page) => page.getByRole('dialog');
const entries = (page: Page) => page.getByRole('article', { name: /^(Highlight|Note)$/ });

async function addHighlight(page: Page, quote: string, note: string): Promise<void> {
  await page.getByRole('button', { name: 'Add highlight' }).click();
  await sheet(page).getByLabel('Quote').fill(quote);
  if (note) await sheet(page).getByLabel('Note').fill(note);
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(sheet(page)).toBeHidden();
}

async function addNote(page: Page, note: string): Promise<void> {
  await page.getByRole('button', { name: 'Add note' }).click();
  await sheet(page).getByLabel('Note').fill(note);
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(sheet(page)).toBeHidden();
}

test('empty state shows the invitation', async ({ page }) => {
  await openArticle(page);
  await expect(page.getByRole('heading', { name: 'Highlights' })).toBeVisible();
  await expect(page.getByText('Select a passage while reading to keep it here.')).toBeVisible();
  await expect(entries(page)).toHaveCount(0);
});

test('an empty Add sheet cannot be saved', async ({ page }) => {
  await openArticle(page);
  await page.getByRole('button', { name: 'Add highlight' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Save' })).toBeDisabled();
  await sheet(page).getByLabel('Note').fill('   ');
  await expect(sheet(page).getByRole('button', { name: 'Save' })).toBeDisabled();
  await sheet(page).getByLabel('Quote').fill('x');
  await expect(sheet(page).getByRole('button', { name: 'Save' })).toBeEnabled();
});

test('add, list oldest first, link, edit, remove and undo', async ({ page }) => {
  await openArticle(page);
  await addHighlight(page, 'First passage', 'my thought');
  await addNote(page, 'only a note');

  await expect(entries(page)).toHaveCount(2);
  const first = page.getByRole('article', { name: 'Highlight' });
  const second = page.getByRole('article', { name: 'Note' });
  await expect(entries(page).first()).toContainText('First passage');
  await expect(entries(page).last()).toContainText('only a note');
  await expect(first).toContainText('my thought');
  const date = first.locator('time');
  await expect(date).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  expect(await date.evaluate((e) => getComputedStyle(e).textTransform)).toBe('uppercase');

  const link = first.getByRole('link', { name: 'First passage' });
  await expect(link).toHaveAttribute('href', URL_ + '#:~:text=First%20passage');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  // Edit note
  await first.getByRole('button', { name: 'More' }).click();
  await sheet(page).getByRole('button', { name: 'Edit note' }).click();
  await sheet(page).getByLabel('Note').fill('changed thought');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(first).toContainText('changed thought');
  await expect(first).not.toContainText('my thought');

  // Remove, then Undo
  await second.getByRole('button', { name: 'More' }).click();
  await sheet(page).getByRole('button', { name: 'Remove' }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(entries(page)).toHaveCount(1);
  await expect(page.getByText('Highlight removed')).toBeVisible();
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(entries(page)).toHaveCount(2);
  await expect(entries(page).last()).toContainText('only a note');
});

test('a note-only entry offers Edit note; a quote-only entry offers Add note', async ({ page }) => {
  await openArticle(page);
  await addHighlight(page, 'Just a quote', '');
  await entries(page).first().getByRole('button', { name: 'More' }).click();
  await expect(sheet(page).getByRole('button', { name: 'Add note' })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Add note' }).click();
  await sheet(page).getByLabel('Note').fill('now with a note');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(entries(page).first()).toContainText('now with a note');
});

test('a 20-line quote is clamped, with Show all', async ({ page }) => {
  await openArticle(page);
  const quote = Array.from({ length: 20 }, (_, i) => `Line number ${i + 1} of a rather long passage`).join('\n');
  await addHighlight(page, quote, '');
  const entry = entries(page).first();
  const block = entry.locator('blockquote');
  const clamped = await block.evaluate((e) => e.clientHeight);
  await entry.getByRole('button', { name: 'Show all' }).click();
  const full = await block.evaluate((e) => e.clientHeight);
  expect(full).toBeGreaterThan(clamped * 1.5);
  await expect(entry.getByRole('button', { name: 'Show all' })).toBeHidden();
});

test('a short quote has no Show all', async ({ page }) => {
  await openArticle(page);
  await addHighlight(page, 'Short one', '');
  await expect(entries(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Show all' })).toHaveCount(0);
});

test('too long a quote is rejected inline', async ({ page }) => {
  await openArticle(page);
  await page.getByRole('button', { name: 'Add highlight' }).click();
  await sheet(page).getByLabel('Quote').fill('a'.repeat(5001));
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(sheet(page).getByText('That passage is too long')).toBeVisible();
  await expect(sheet(page)).toBeVisible();
});

test('SC-006: 200 highlights render within 200 ms of navigating to the article', async ({ page }) => {
  test.setTimeout(300_000);
  await openArticle(page);
  const articleHash = new URL(page.url()).hash;
  for (let i = 1; i <= 200; i++) {
    await page.getByRole('button', { name: 'Add note' }).click();
    await sheet(page).getByLabel('Note').fill(`Note number ${i}`);
    await sheet(page).getByRole('button', { name: 'Save' }).click();
    await expect(sheet(page)).toBeHidden();
  }
  await expect(entries(page)).toHaveCount(200);

  const times: number[] = [];
  for (let run = 0; run < 3; run++) {
    await page.goto('/#/library');
    await expect(page.getByRole('tab', { name: 'Articles' })).toBeVisible();
    await page.evaluate((h) => { location.hash = h; performance.mark('hl-nav'); }, articleHash);
    await expect(page.getByText('Note number 200', { exact: true })).toBeVisible();
    times.push(await page.evaluate(() => performance.now() - performance.getEntriesByName('hl-nav').at(-1)!.startTime));
  }
  console.log(`200 highlights → list: ${times.map((t) => t.toFixed(0)).join(', ')} ms`);
  expect(Math.min(...times)).toBeLessThan(200);
});
