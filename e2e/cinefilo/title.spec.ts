import { addByHand, expect, openApp, startList, tab, test } from './fixtures.ts';

test('status, watched date, season stepper, remove with undo', async ({ page }) => {
  await startList(page, 'Ana');
  await addByHand(page, { title: 'Severance', kind: 'Series', year: '2022' });
  await addByHand(page, { title: 'Heat', year: '1995' });

  await page.getByRole('link', { name: /Heat/ }).click();
  // Movies cannot be watching or dropped.
  await expect(page.getByRole('group', { name: 'Status' }).getByRole('button')).toHaveText(['Watch later', 'Watched']);
  await page.getByRole('button', { name: 'Watched', exact: true }).click();
  await expect(page.getByText('Watched on')).toBeVisible();
  const today = await page.locator('time').getAttribute('datetime');
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole('button', { name: 'Yesterday' }).click();
  await expect(page.locator('time')).not.toHaveAttribute('datetime', today!);
  await page.getByLabel('Pick a date').fill('2024-01-05');
  await expect(page.locator('time')).toHaveAttribute('datetime', '2024-01-05');
  // Back to later clears the date.
  await page.getByRole('button', { name: 'Watch later', exact: true }).click();
  await expect(page.getByText('Watched on')).toBeHidden();

  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('link', { name: /Severance/ }).click();
  await page.getByRole('button', { name: 'Watching', exact: true }).click();
  await page.getByRole('button', { name: 'Next season' }).click();
  await page.getByRole('button', { name: 'Next season' }).click();
  await expect(page.getByText('Season 2')).toBeVisible();
  await page.getByRole('button', { name: 'Previous season' }).click();
  await expect(page.getByText('Season 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous season' })).toBeDisabled();
  await tab(page, 'Watching').click();
  await expect(page.getByRole('link', { name: /Severance.*Season 1/ })).toBeVisible();

  // Remove, then Undo.
  await page.getByRole('link', { name: /Severance/ }).click();
  await page.getByRole('button', { name: 'Remove from list' }).click();
  await expect(page.getByRole('link', { name: /Severance/ })).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: /Severance/ })).toBeVisible();
});

test('verdict in one tap, toggle off, review limit, partner column read-only', async ({ page, newDevice }) => {
  const code = await startList(page, 'Ana');
  await addByHand(page, { title: 'Heat', year: '1995', status: 'Watched' });
  await tab(page, 'Watched').click();
  await page.getByRole('link', { name: /Heat/ }).click();
  const mine = page.getByTestId('rating-mine');
  await mine.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(mine.getByRole('button', { name: 'Like', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await mine.getByRole('button', { name: 'Meh' }).click();
  await expect(mine.getByRole('button', { name: 'Meh' })).toHaveAttribute('aria-pressed', 'true');
  await mine.getByRole('button', { name: 'Meh' }).click();
  await expect(mine.getByRole('button', { name: 'Meh' })).toHaveAttribute('aria-pressed', 'false');
  await expect(mine.getByRole('button', { name: 'Like', exact: true })).toHaveAttribute('aria-pressed', 'false');

  // Review without a verdict; over the limit is refused with the limit shown.
  await mine.getByLabel('Your review').fill('x'.repeat(1001));
  await mine.getByRole('button', { name: 'Save review' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'at most 1,000' })).toBeVisible();
  await mine.getByLabel('Your review').fill('  Great heist.  ');
  await mine.getByRole('button', { name: 'Save review' }).click();
  await expect(mine.getByRole('button', { name: 'Save review' })).toBeHidden();
  await expect(mine.getByLabel('Your review')).toHaveValue('Great heist.');

  // The partner sees it read-only, and "not rated yet" for themselves.
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  const b = await newDevice();
  await openApp(b.page);
  await b.page.getByRole('button', { name: 'Join with a code' }).click();
  await b.page.getByLabel('Sync code').fill(code);
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await b.page.getByLabel('I\'m new').fill('Luz');
  await b.page.getByRole('button', { name: 'Create me' }).click();
  await tab(b.page, 'Watched').click();
  await b.page.getByRole('link', { name: /Heat/ }).click();
  await expect(b.page.getByTestId('rating-partner')).toContainText('Great heist.');
  await expect(b.page.getByTestId('rating-partner').getByRole('button')).toHaveCount(0);
  await expect(b.page.getByTestId('rating-partner').locator('textarea')).toHaveCount(0);
});
