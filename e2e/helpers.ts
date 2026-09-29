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

export async function openLogSheet(page: Page) {
  await currentCard(page).getByRole('button', { name: 'Log' }).click();
  const sheet = page.getByRole('dialog', { name: 'Log progress' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The local date of the current book's latest entry, from its <time datetime>. */
export const lastReadDate = (page: Page) => currentCard(page).locator('time').getAttribute('datetime');

/**
 * Log a reading entry dated `isoDate` through the UI by moving the (already installed) fake
 * clock to that day first. `pageNo` logs that page; otherwise it taps "Read today".
 */
export async function logOnDay(page: Page, isoDate: string, opts: { page?: number } = {}): Promise<void> {
  await page.clock.setFixedTime(new Date(`${isoDate}T17:00:00Z`));
  await page.goto('/#/');
  const sheet = await openLogSheet(page);
  if (opts.page !== undefined) {
    await sheet.getByLabel('Page', { exact: true }).fill(String(opts.page));
    await sheet.getByRole('button', { name: 'Save' }).click();
  } else {
    await sheet.getByRole('button', { name: 'Read today' }).click();
  }
  await expect(sheet).toBeHidden();
}
