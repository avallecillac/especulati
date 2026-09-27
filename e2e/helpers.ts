import { expect, type Page } from '@playwright/test';

/** Open the app and wait until the DB worker answered the first query. */
export async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('ready')).toBeAttached();
}

export async function addBook(
  page: Page,
  opts: { title: string; author?: string; pages?: number; genre?: string; start?: boolean },
): Promise<void> {
  await page.goto('/#/add');
  await page.getByLabel('Title').fill(opts.title);
  if (opts.author) await page.getByLabel('Author').fill(opts.author);
  if (opts.pages !== undefined) await page.getByLabel('Total pages').fill(String(opts.pages));
  if (opts.genre) await page.getByLabel('Genre').fill(opts.genre);
  const start = page.getByLabel('Start reading now');
  if ((opts.start ?? true) !== (await start.isChecked())) await start.click();
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
}

export const currentCard = (page: Page) => page.getByRole('region', { name: 'Current book' });
