import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, openApp, startList, tab, test } from './fixtures.ts';
import { importCatalogue } from './seed.ts';
import { installTmdb, saveKey } from './tmdb.ts';

// Task 4.1: one capture per main screen and theme at 390×844, for the visual comparison with the design canvas.
// The files are not committed (see .gitignore).
const DIR = fileURLToPath(new URL('./__screens__/', import.meta.url));
test.use({ viewport: { width: 390, height: 844 } });

async function shoot(page: Page, theme: string, name: string): Promise<void> {
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${DIR}${theme}-${name}.png` });
}

for (const [id, label] of [['beton', 'Béton'], ['willis', 'Willis']] as const) {
  test(`screens in ${label}`, async ({ page, context }) => {
    mkdirSync(DIR, { recursive: true });
    await installTmdb(context);
    await page.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), id);
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    await shoot(page, id, '01-welcome');

    await startList(page, 'Ana');
    await importCatalogue(page);

    await tab(page, 'Watch later').click();
    await expect(page.getByRole('link', { name: /Inception/ })).toBeVisible();
    await shoot(page, id, '02-watch-later');

    await tab(page, 'Watching').click();
    await expect(page.getByRole('link', { name: /The Bear/ })).toBeVisible();
    await expect(page.getByTestId('season-progress')).toHaveCount(3);
    await shoot(page, id, '03-watching');

    await tab(page, 'Watched').click();
    await expect(page.getByRole('link', { name: /The Godfather/ })).toBeVisible();
    await expect(page.getByRole('img', { name: 'You: 5 stars' })).toHaveCount(1);
    await shoot(page, id, '04-watched');

    await page.getByRole('link', { name: /The Godfather/ }).click();
    await expect(page.getByRole('heading', { name: 'The Godfather' })).toBeVisible();
    await shoot(page, id, '05-title');
    await page.getByTestId('rating-mine').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shoot(page, id, '05b-title-ratings');

    await tab(page, 'Settings').click();
    await expect(page.getByRole('radiogroup', { name: 'Appearance' })).toBeVisible();
    await shoot(page, id, '07-settings');

    await saveKey(page);
    await tab(page, 'Watch later').click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a title' });
    await sheet.getByRole('button', { name: 'Series' }).click();
    await sheet.getByLabel('Search TMDB').fill('Severance');
    await sheet.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(sheet.getByRole('list', { name: 'Search results' }).getByRole('listitem')).toHaveCount(1);
    await shoot(page, id, '06-add-sheet');
  });
}
