import { currentCard } from './helpers';
import { expect, test } from './fixtures/catalog';

const DUNE = '9780441172719';

test('(12) a stored cover shows offline after a reload; removing the book drops it', async ({ page, context, fakeCamera }) => {
  await fakeCamera.show(DUNE);
  await page.goto('/');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: 'Scan barcode' }).or(page.getByRole('button', { name: 'Scan barcode' })).click();
  await expect(page).toHaveURL(/#\/add$/, { timeout: 15_000 });
  await expect(page.getByLabel('Title')).toHaveValue('Dune');
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);

  const cardImg = currentCard(page).getByRole('img', { name: 'Cover of Dune' });
  await expect(cardImg).toHaveAttribute('src', /^blob:/, { timeout: 10_000 });

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await expect(cardImg).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => cardImg.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  // The worker's cache holds exactly this one cover...
  await page.goto('/#/settings');
  await expect(page.getByTestId('cover-stats')).toHaveText(/^Covers stored: 1 \(/);
  await page.goto('/#/');

  // ...and removing the book deletes it (research R5); nothing else can drop the row.
  await currentCard(page).getByRole('link', { name: 'Dune' }).click();
  await page.getByRole('button', { name: 'Remove book' }).click();
  await page.getByRole('alertdialog', { name: 'Remove this book?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await page.goto('/#/settings');
  await expect(page.getByTestId('cover-stats')).toHaveText(/^Covers stored: 0 \(0 KB\)$/);

  await page.goto('/#/isbn');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByLabel('ISBN').fill(DUNE);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByRole('status').filter({ hasText: "Details will be looked up when you're online." })).toBeVisible();
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);

  const card = currentCard(page);
  await expect(card.getByRole('link', { name: `ISBN ${DUNE}` })).toBeVisible();
  await expect(card.locator('.cover.generated')).toBeVisible();
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
});
