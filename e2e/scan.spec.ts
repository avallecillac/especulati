import { currentCard } from './helpers';
import { expect, test } from './fixtures/catalog';

const DUNE = '9780441172719';

test('(a) scan to add: 3 clicks, prefilled confirmation, cover on Home', async ({ page, fakeCamera }) => {
  await fakeCamera.show(DUNE);
  await page.goto('/');
  await expect(page.getByTestId('ready')).toBeAttached();

  let clicks = 0;
  const click = async (loc: ReturnType<typeof page.getByRole>) => {
    clicks++;
    await loc.click();
  };
  await click(page.getByRole('link', { name: 'Add', exact: true }));
  await click(page.getByRole('link', { name: 'Scan barcode' }).or(page.getByRole('button', { name: 'Scan barcode' })));

  // Detection navigates to the confirmation by itself (no click).
  await expect(page).toHaveURL(/#\/add$/, { timeout: 15_000 });
  await expect(page.getByLabel('Title')).toHaveValue('Dune');
  await expect(page.getByLabel('Author')).toHaveValue('Frank Herbert');
  await expect(page.getByLabel('Total pages')).toHaveValue('535');
  await expect(page.getByRole('status').filter({ hasText: 'Found in' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Cover of Dune' })).toBeVisible();

  await click(page.getByRole('button', { name: 'Save book' }));
  await expect(page).toHaveURL(/#\/$/);
  await expect(currentCard(page).getByRole('link', { name: 'Dune' })).toBeVisible();
  await expect(currentCard(page).getByRole('img', { name: 'Cover of Dune' })).toBeVisible();
  expect(clicks).toBe(3);
});

test('(b) UPC and ISMN are ignored; the hint appears after 10 s', async ({ page, fakeCamera }) => {
  await fakeCamera.show('012345678905');
  await page.clock.install();
  await page.goto('/#/scan');
  await expect(page.getByRole('heading', { name: 'Scan barcode' })).toBeVisible();
  await expect.poll(() => fakeCamera.requests()).toBeGreaterThan(0);
  await expect(page.getByText('Having trouble?')).toBeHidden();

  // The app arms its 10 s hint timer only after getUserMedia AND video.play() resolve, which
  // is later than the getUserMedia request seen above (slow under load). A single fastForward
  // before that would be lost, so wait until the video plays, then advance the fake clock in
  // steps until the hint shows. Time only moves after the timer exists; the 10 s total still holds.
  await expect.poll(() => page.evaluate(() => {
    const v = document.querySelector('video');
    return !!v && !!v.srcObject && !v.paused;
  })).toBe(true);
  await expect(async () => {
    await page.clock.fastForward(2_000);
    await expect(page.getByText('Having trouble?')).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Enter ISBN' })).toBeVisible();

  await fakeCamera.show('9790001234566');
  await page.clock.resume();
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/#\/scan$/);
});

test('(c) leaving the scan view stops every camera track', async ({ page, fakeCamera }) => {
  await fakeCamera.show('012345678905');
  await page.goto('/#/scan');
  await expect.poll(() => fakeCamera.liveTracks()).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect.poll(() => fakeCamera.liveTracks()).toBe(0);
  expect(fakeCamera.stoppedTracks()).toBeGreaterThanOrEqual(1);
});

test('(d) scanning a book already in the library offers to open it or add a copy', async ({ page, fakeCamera }) => {
  await fakeCamera.show(DUNE);
  await page.goto('/#/scan');
  await expect(page.getByLabel('Title')).toHaveValue('Dune', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);

  await page.goto('/#/scan');
  const dialog = page.getByRole('alertdialog', { name: 'Already in your library' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('button', { name: 'Add another copy' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open existing' }).click();
  await expect(page).toHaveURL(/#\/book\//);
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible();

  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('link', { name: /Dune/ })).toHaveCount(1);
});
