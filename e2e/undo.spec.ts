import { expect, test } from '@playwright/test';
import { addBook, currentCard, openApp, openLogSheet } from './helpers.ts';

test.describe('US4: undo a mistaken entry', () => {
  test('the toast Undo removes the entry just saved', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 600 });
    let sheet = await openLogSheet(page);
    await sheet.getByLabel('Page', { exact: true }).fill('120');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(currentCard(page).getByText('p. 120 / 600')).toBeVisible();

    sheet = await openLogSheet(page);
    await sheet.getByLabel('Page', { exact: true }).fill('500');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(currentCard(page).getByText('p. 500 / 600')).toBeVisible();

    await page.getByRole('status').getByRole('button', { name: 'Undo' }).last().click();
    await expect(currentCard(page).getByText('p. 120 / 600')).toBeVisible();
    await expect(page.getByRole('status').getByText('Entry removed')).toBeVisible();
  });

  test('removing an older entry from history recomputes status and last page', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 600 });
    for (const p of ['100', '500']) {
      const s = await openLogSheet(page);
      await s.getByLabel('Page', { exact: true }).fill(p);
      await s.getByRole('button', { name: 'Save' }).click();
      await expect(currentCard(page).getByText(`p. ${p} / 600`)).toBeVisible();
    }
    await currentCard(page).getByRole('link', { name: 'Dune' }).click();
    const history = page.getByRole('list', { name: 'History' });
    await history.getByRole('listitem').filter({ hasText: 'Page 500' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('alertdialog', { name: 'Remove this entry?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(history.getByText('Page 500')).toHaveCount(0);
    await expect(page.getByText('p. 100 / 600')).toBeVisible();

    // Removing the only start entry sends the book back to Queued.
    await history.getByRole('listitem').filter({ hasText: 'Page 100' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('alertdialog', { name: 'Remove this entry?' }).getByRole('button', { name: 'Remove' }).click();
    await history.getByRole('listitem').filter({ hasText: 'Started' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('alertdialog', { name: 'Remove this entry?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Queued', { exact: true })).toBeVisible();
  });
});
