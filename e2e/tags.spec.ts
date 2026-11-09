import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.ts';

// Feature 008 US3: tag articles, read or saved; rename (merging), delete, and the 20-tag limit.

const url = (slug: string) => `https://www.example.com/read/${slug}`;

/** Seed an article through a capture link: logged as read, or saved for later, or with a highlight. */
async function capture(page: Page, slug: string, o: { later?: boolean; quote?: string } = {}): Promise<void> {
  const json = JSON.stringify({
    v: 1,
    url: url(slug),
    title: `Essay ${slug}`,
    author: 'Ann Author',
    words: 2380,
    at: new Date().toISOString(),
    ...(o.later ? { later: 1 } : {}),
    ...(o.quote ? { quote: o.quote } : {}),
  });
  await page.goto(`/#/capture?d=${encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'))}`);
  await expect(page.getByText(o.later ? 'Saved for later' : o.quote ? 'Highlight saved' : /^Logged: /)).toBeVisible();
}

/** Open a read article's screen from the Articles list. */
async function openArticle(page: Page, slug: string): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Articles' }).click();
  await page.getByTestId('article-row').filter({ hasText: `Essay ${slug}` }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: `Essay ${slug}` })).toBeVisible();
}

/** Open a saved article's screen through the Saved list's More sheet. */
async function openSaved(page: Page, slug: string): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Saved' }).click();
  await page.getByTestId('saved-row').filter({ hasText: `Essay ${slug}` }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Details' }).click();
  await expect(page.getByRole('heading', { name: `Essay ${slug}` })).toBeVisible();
}

const input = (page: Page) => page.getByRole('combobox', { name: 'Add tag', exact: true });
const chip = (page: Page, name: string) => page.getByRole('button', { name: `Remove tag ${name}`, exact: true });

async function addTag(page: Page, name: string): Promise<void> {
  await input(page).fill(name);
  await input(page).press('Enter');
}

async function openTagsSheet(page: Page) {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Articles' }).click();
  await page.getByRole('button', { name: 'All tags…' }).click();
  const sheet = page.getByRole('dialog', { name: 'All tags' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('adds a new tag by typing, and an existing one through its suggestion in two taps (SC-005)', async ({ page }) => {
  await openApp(page);
  await capture(page, 'one');
  await capture(page, 'two');
  await openArticle(page, 'one');
  await addTag(page, 'ai');
  await expect(chip(page, 'ai')).toBeVisible();

  await openArticle(page, 'two');
  await input(page).click(); // tap 1: the suggestions open
  await page.getByRole('listbox', { name: 'Tag suggestions' }).getByRole('option', { name: 'ai', exact: true }).click(); // tap 2
  await expect(chip(page, 'ai')).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Tag suggestions' })).toBeHidden();
});

test('suggestions filter as you type, most used first, and work by keyboard', async ({ page }) => {
  await openApp(page);
  await capture(page, 'one');
  await capture(page, 'two');
  await capture(page, 'three');
  await openArticle(page, 'one');
  await addTag(page, 'ml');
  await addTag(page, 'math');
  await openArticle(page, 'two');
  await addTag(page, 'math');
  await openArticle(page, 'three');
  await input(page).click();
  const options = page.getByRole('option');
  await expect(options.nth(0)).toHaveAccessibleName('math'); // used twice, ahead of "ml"
  await expect(options.nth(1)).toHaveAccessibleName('ml');
  await input(page).fill('m');
  await expect(options).toHaveCount(2);
  await input(page).fill('ml');
  await expect(options).toHaveCount(1);
  await input(page).press('ArrowDown');
  await input(page).press('Enter');
  await expect(chip(page, 'ml')).toBeVisible();
});

test('"AI" and " ai " are the same tag', async ({ page }) => {
  await openApp(page);
  await capture(page, 'one');
  await capture(page, 'two');
  await openArticle(page, 'one');
  await addTag(page, 'AI');
  await expect(chip(page, 'AI')).toBeVisible();
  await addTag(page, ' ai ');
  await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(1);
  await openArticle(page, 'two');
  await addTag(page, ' ai ');
  await expect(chip(page, 'AI')).toBeVisible();

  const sheet = await openTagsSheet(page);
  await expect(sheet.getByRole('listitem')).toHaveCount(1);
  await expect(sheet.getByRole('listitem')).toContainText('2 articles');
});

test('removes a tag from an article, and works on a saved article too', async ({ page }) => {
  await openApp(page);
  await capture(page, 'later', { later: true });
  await openSaved(page, 'later');
  await addTag(page, 'ai');
  await expect(chip(page, 'ai')).toBeVisible();
  await chip(page, 'ai').click();
  await expect(chip(page, 'ai')).toHaveCount(0);
  await addTag(page, 'ai'); // re-adding restores it
  await expect(chip(page, 'ai')).toBeVisible();
});

test('renaming a tag shows the new name everywhere', async ({ page }) => {
  await openApp(page);
  await capture(page, 'one');
  await capture(page, 'two', { later: true });
  await openArticle(page, 'one');
  await addTag(page, 'ai');
  await openSaved(page, 'two');
  await addTag(page, 'ai');

  const sheet = await openTagsSheet(page);
  await sheet.getByRole('button', { name: 'Rename ai' }).click();
  await sheet.getByLabel('New name').fill('machine learning');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('listitem')).toHaveCount(1);
  await expect(sheet.getByRole('listitem')).toContainText('machine learning');
  await sheet.getByRole('button', { name: 'Close' }).click();

  await openArticle(page, 'one');
  await expect(chip(page, 'machine learning')).toBeVisible();
  await expect(chip(page, 'ai')).toHaveCount(0);
  await openSaved(page, 'two');
  await expect(chip(page, 'machine learning')).toBeVisible();
});

test('renaming into an existing name merges the two tags', async ({ page }) => {
  await openApp(page);
  await capture(page, 'one');
  await capture(page, 'two');
  await capture(page, 'three');
  await openArticle(page, 'one');
  await addTag(page, 'ai');
  await openArticle(page, 'two');
  await addTag(page, 'ml');
  await openArticle(page, 'three');
  await addTag(page, 'ai');
  await addTag(page, 'ml');

  const sheet = await openTagsSheet(page);
  await sheet.getByRole('button', { name: 'Rename ml' }).click();
  await sheet.getByLabel('New name').fill('AI');
  await expect(sheet.getByText('Merges into ai')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('listitem')).toHaveCount(1);
  await expect(sheet.getByRole('listitem')).toContainText('ai');
  await expect(sheet.getByRole('listitem')).toContainText('3 articles');
  await sheet.getByRole('button', { name: 'Close' }).click();

  await openArticle(page, 'two');
  await expect(chip(page, 'ai')).toBeVisible();
  await expect(chip(page, 'ml')).toHaveCount(0);
  await openArticle(page, 'three');
  await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(1);
});

test('deleting a tag removes it from every article and keeps the articles', async ({ page }) => {
  await openApp(page);
  await capture(page, 'one');
  await capture(page, 'two', { later: true });
  await openArticle(page, 'one');
  await addTag(page, 'ai');
  await addTag(page, 'keep');
  await openSaved(page, 'two');
  await addTag(page, 'ai');

  const sheet = await openTagsSheet(page);
  await sheet.getByRole('button', { name: 'Delete ai' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(sheet.getByRole('listitem')).toHaveCount(1);
  await expect(sheet.getByRole('listitem')).toContainText('keep');
  await sheet.getByRole('button', { name: 'Close' }).click();

  await openArticle(page, 'one');
  await expect(chip(page, 'ai')).toHaveCount(0);
  await expect(chip(page, 'keep')).toBeVisible();
  await openSaved(page, 'two');
  await expect(chip(page, 'ai')).toHaveCount(0);
});

test('the 21st tag is refused with its message', async ({ page }) => {
  await openApp(page);
  await capture(page, 'one');
  await openArticle(page, 'one');
  for (let i = 1; i <= 20; i++) {
    await addTag(page, `tag${i}`);
    await expect(input(page)).toHaveValue(''); // saved: the field clears
  }
  await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(20);
  await addTag(page, 'tag21');
  await expect(page.getByRole('alert').filter({ hasText: 'An article can have up to 20 tags' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(20);
});

test('the capture screen offers Add tags in log, save and highlight modes', async ({ page }) => {
  await openApp(page);
  await capture(page, 'logged');
  await page.getByRole('button', { name: 'Add tags' }).click();
  await addTag(page, 'ai');
  await expect(chip(page, 'ai')).toBeVisible();

  await capture(page, 'later', { later: true });
  await page.getByRole('button', { name: 'Add tags' }).click();
  await input(page).click();
  await page.getByRole('option', { name: 'ai', exact: true }).click();
  await expect(chip(page, 'ai')).toBeVisible();

  await capture(page, 'quoted', { quote: 'A passage worth keeping.' });
  await page.getByRole('button', { name: 'Add tags' }).click();
  await addTag(page, 'ai');
  await expect(chip(page, 'ai')).toBeVisible();

  const sheet = await openTagsSheet(page);
  await expect(sheet.getByRole('listitem')).toContainText('3 articles');
});
