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
    hash('book', s.bookHash),
    hash('article', s.articleHash),
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
