import { addByHand, expect, openApp, startList, tab, tapStars, test } from './fixtures.ts';

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

test('stars: tap halves, drag, keyboard, clear, offline; review limit; partner read-only', async ({ page, newDevice, context }) => {
  const code = await startList(page, 'Ana');
  await addByHand(page, { title: 'Heat', year: '1995', status: 'Watched' });
  await tab(page, 'Watched').click();
  await page.getByRole('link', { name: /Heat/ }).click();
  const mine = page.getByTestId('rating-mine');
  const slider = mine.getByRole('slider', { name: 'Your rating' });
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  await expect(slider).not.toHaveAttribute('aria-valuenow');
  await expect(mine.getByRole('button', { name: 'Clear' })).toHaveCount(0);

  await context.setOffline(true);
  // The left half of the fourth star is 3.5; the right half of the first star is 1.
  await slider.click({ position: { x: 3 * 32 + 8, y: 16 } });
  await expect(slider).toHaveAttribute('aria-valuetext', '3.5 stars');
  await expect(slider).toHaveAttribute('aria-valuenow', '3.5');
  await tapStars(slider, 2);
  await expect(slider).toHaveAttribute('aria-valuetext', '1 star');
  // Tapping exactly the current value keeps it.
  await tapStars(slider, 2);
  await expect(slider).toHaveAttribute('aria-valuetext', '1 star');

  // Dragging writes where the pointer is released.
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 16);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 16);
  await expect(slider).toHaveAttribute('aria-valuetext', '2.5 stars'); // the preview follows the pointer
  await page.mouse.move(box.x + box.width + 40, box.y + 16);
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuetext', '5 stars');

  // Keyboard.
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext', '4.5 stars');
  await page.keyboard.press('ArrowDown');
  await expect(slider).toHaveAttribute('aria-valuetext', '4 stars');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await expect(slider).toHaveAttribute('aria-valuetext', '5 stars');
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', '0.5 stars');
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '5 stars');
  await page.keyboard.press('Delete');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '0.5 stars');
  await page.keyboard.press('Backspace');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');

  // Clear.
  await tapStars(slider, 7);
  await expect(slider).toHaveAttribute('aria-valuetext', '3.5 stars');
  await mine.getByRole('button', { name: 'Clear' }).click();
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  await expect(mine.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await tapStars(slider, 9);
  await expect(slider).toHaveAttribute('aria-valuetext', '4.5 stars');
  await context.setOffline(false);

  // The page still scrolls with a finger on the review, and only the star row blocks touch panning.
  expect(await slider.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
  expect(await mine.getByLabel('Your review').evaluate((el) => getComputedStyle(el).touchAction)).not.toBe('none');

  // Review with stars already set; over the limit is refused with the limit shown.
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
  await expect(b.page.getByTestId('rating-partner').getByRole('slider')).toHaveCount(0);
  await expect(b.page.getByTestId('rating-partner').getByRole('img', { name: 'Ana: 4.5 stars' })).toBeVisible();
  await expect(b.page.getByTestId('rating-mine').getByRole('slider', { name: 'Your rating' })).toHaveAttribute('aria-valuetext', 'Not rated');
  await expect(b.page.getByTestId('rating-partner').locator('textarea')).toHaveCount(0);
});
