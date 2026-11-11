import { expect, startList, tab, test } from './fixtures.ts';

test('tab navigation across the four sections', async ({ page }) => {
  await startList(page, 'Ana');
  await expect(page.getByRole('heading', { name: 'Watch later' })).toBeVisible();
  for (const [name, heading] of [['Watching', 'Watching'], ['Watched', 'Watched'], ['Settings', 'Settings'], ['Watch later', 'Watch later']] as const) {
    await tab(page, name).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
  }
});

test('first run shows the code as text and QR, and reopening keeps the identity', async ({ page }) => {
  await openAndStart(page);
});

async function openAndStart(page: import('@playwright/test').Page) {
  const code = await startList(page, 'Andrés');
  expect(code.length).toBeGreaterThan(10);
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Watch later' })).toBeVisible();
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Show code' }).click();
  await expect(page.getByTestId('sync-code')).toHaveText(code);
  await expect(page.getByRole('img', { name: 'Sync code QR' }).locator('svg')).toBeVisible();
  await expect(page.getByText('Anyone who has the sync code can read the whole list')).toBeVisible();
}
