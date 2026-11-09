import { expect, type Page } from '@playwright/test';
import { addBook, openApp, openLogSheet } from './helpers.ts';

export const THEMES = ['macondo', 'patriarca'] as const;
export type ThemeName = (typeof THEMES)[number];

/** Pick the theme before the app loads (the pre-paint script reads this key). */
export async function forceTheme(page: Page, theme: ThemeName): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem('readerlog.appearance', t), theme);
}

/** Seed an article the way the iPhone Shortcut does: through a capture link. */
export async function captureArticle(page: Page, o: { url: string; title: string; author: string; words?: number }): Promise<void> {
  const json = JSON.stringify({ v: 1, words: 2380, at: new Date().toISOString(), ...o });
  await page.goto(`/#/capture?d=${encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'))}`);
  await expect(page.getByText(/^Logged: /)).toBeVisible();
}

/** Two highlights on the article: one with a 120-character unbroken quote and a note, one note on its own. */
async function seedHighlights(page: Page, articleHash: string): Promise<void> {
  await page.goto(`/${articleHash}`);
  const sheet = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Add highlight' }).click();
  await sheet.getByLabel('Quote').fill('Q'.repeat(120));
  await sheet.getByLabel('Note').fill('A thought that is worth keeping.');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: 'Add note' }).click();
  await sheet.getByLabel('Note').fill('Only a note, no quote.');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('article', { name: /^(Highlight|Note)$/ })).toHaveCount(2);
}

const tagInput = (page: Page) => page.getByRole('combobox', { name: 'Add tag', exact: true });

/** Tag the article on screen; each tag is confirmed by its remove button. */
async function addTags(page: Page, tags: string[]): Promise<void> {
  for (const t of tags) {
    await tagInput(page).fill(t);
    await tagInput(page).press('Enter');
    await expect(page.getByRole('button', { name: `Remove tag ${t}`, exact: true })).toBeVisible();
  }
}

/** Save an article for later, as the Shortcut's `later` link does, and tag it from its Details screen. */
async function seedSaved(page: Page, a: { url: string; title: string; author: string }, tags: string[]): Promise<void> {
  const json = JSON.stringify({ v: 1, words: 2380, at: new Date().toISOString(), ...a, later: 1 });
  await page.goto(`/#/capture?d=${encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'))}`);
  await expect(page.getByText('Saved for later')).toBeVisible();
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Saved' }).click();
  await page.getByTestId('saved-row').first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Details' }).click();
  await addTags(page, tags);
}

export interface Seeded {
  bookHash: string;
  articleHash: string;
}

/** A reading book with a logged page, a queued book, and an article; titles are whatever the caller passes. */
export async function seedScreens(
  page: Page,
  o: { reading: { title: string; author: string }; queued: { title: string; author: string }; article: { url: string; title: string; author: string } },
): Promise<Seeded> {
  await openApp(page);
  await addBook(page, { ...o.reading, pages: 300, genre: 'Fiction', start: true });
  const sheet = await openLogSheet(page);
  await sheet.getByLabel('Page', { exact: true }).fill('42');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  await addBook(page, { ...o.queued, pages: 200, start: false });
  await captureArticle(page, o.article);

  await page.goto('/#/library');
  const bookHash = (await page.locator('a[href^="#/book/"]').first().getAttribute('href'))!;
  await page.getByRole('tab', { name: 'Articles' }).click();
  const articleHash = (await page.locator('a[href^="#/article/"]').first().getAttribute('href'))!;
  await seedHighlights(page, articleHash);
  // Tags: the read article has two, a saved article has one shared and one of its own (so the article's suggestions are not empty).
  await page.goto(`/${articleHash}`);
  await addTags(page, ['ai', 'ml']);
  await seedSaved(page, { ...o.article, url: `${o.article.url}-saved`, title: `Saved ${o.article.title}` }, ['ai', 'reference']);
  return { bookHash, articleHash };
}

/** Every screen, as [name, how to reach it]. The log sheet is opened from Home. */
export function screens(s: Seeded): { name: string; go: (page: Page) => Promise<void> }[] {
  const hash = (name: string, h: string) => ({
    name,
    go: async (page: Page) => {
      await page.goto(`/${h}`);
      await expect(page.getByTestId('ready')).toBeAttached();
    },
  });
  return [
    hash('home', '#/'),
    {
      name: 'library books',
      go: async (page) => {
        await page.goto('/#/library');
        await page.getByRole('tab', { name: 'Books' }).click();
      },
    },
    {
      name: 'library articles',
      go: async (page) => {
        await page.goto('/#/library');
        await page.getByRole('tab', { name: 'Articles' }).click();
      },
    },
    {
      name: 'library saved',
      go: async (page) => {
        await page.goto('/#/library');
        await page.getByRole('tab', { name: 'Saved' }).click();
        await expect(page.getByTestId('saved-row')).toHaveCount(1);
      },
    },
    {
      name: 'library search',
      go: async (page) => {
        await page.goto('/#/library');
        await page.getByRole('tab', { name: 'Articles' }).click();
        await page.getByRole('button', { name: 'ai', exact: true }).click();
        await page.getByRole('searchbox', { name: 'Search articles' }).fill('worth');
        await expect(page.getByTestId('search-row')).toHaveCount(1);
        await expect(page.getByTestId('search-row').locator('mark')).toBeVisible();
      },
    },
    {
      name: 'all tags sheet',
      go: async (page) => {
        await page.goto('/#/library');
        await page.getByRole('tab', { name: 'Articles' }).click();
        await page.getByRole('button', { name: 'All tags…' }).click();
        await expect(page.getByRole('dialog', { name: 'All tags' })).toBeVisible();
      },
    },
    hash('book', s.bookHash),
    hash('article', s.articleHash),
    {
      name: 'article tag suggestions',
      go: async (page) => {
        await page.goto(`/${s.articleHash}`);
        await expect(page.getByTestId('ready')).toBeAttached();
        await tagInput(page).click();
        await expect(page.getByRole('listbox', { name: 'Tag suggestions' })).toBeVisible();
      },
    },
    hash('add', '#/add'),
    hash('stats', '#/stats'),
    hash('settings', '#/settings'),
    hash('sync settings', '#/settings/sync'),
    {
      name: 'log sheet',
      go: async (page) => {
        await page.goto('/#/');
        await openLogSheet(page);
      },
    },
  ];
}

/** Wait for fonts and every running animation/transition (the route fade, the sheet) so scans see final colours. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}
