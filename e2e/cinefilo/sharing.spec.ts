import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { addByHand, expect, expectQrVisible, openApp, startList, tab, test } from './fixtures.ts';

async function join(page: Page, code: string, me: { new: string } | { existing: string }) {
  await openApp(page);
  await page.getByRole('button', { name: 'Join with a code' }).click();
  await page.getByLabel('Sync code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  if ('new' in me) {
    await page.getByLabel("I'm new").fill(me.new);
    await page.getByRole('button', { name: 'Create me' }).click();
  } else {
    await page.getByRole('button', { name: `I'm ${me.existing}` }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
}

async function syncNow(page: Page) {
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
}

test('Settings → Show code renders a scannable QR', async ({ page }) => {
  await startList(page, 'Ana');
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Show code' }).click();
  await expectQrVisible(page);
});

test('an invalid code is rejected', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Join with a code' }).click();
  await page.getByLabel('Sync code').fill('not a code');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/typo|No shared list/);
  await expect(page.getByRole('button', { name: "I'm new" })).toHaveCount(0);
});

test('partner joins, sees the catalog; both rate offline and converge', async ({ page: a, newDevice }) => {
  const code = await startList(a, 'Ana');
  await addByHand(a, { title: 'Heat', year: '1995', status: 'Watched' });
  await syncNow(a); // push now rather than wait for the 1.5 s write timer
  const b = await newDevice();
  await join(b.page, code, { new: 'Luz' });
  await tab(b.page, 'Watched').click();
  await expect(b.page.getByRole('link', { name: /Heat/ })).toBeVisible();

  await tab(a, 'Watched').click();
  await a.getByRole('link', { name: /Heat/ }).click();
  await b.page.getByRole('link', { name: /Heat/ }).click();
  await a.context().setOffline(true);
  await b.context.setOffline(true);
  await a.getByTestId('rating-mine').getByRole('button', { name: 'Like', exact: true }).click();
  await b.page.getByTestId('rating-mine').getByRole('button', { name: "Didn't like" }).click();
  await a.context().setOffline(false);
  await b.context.setOffline(false);

  await syncNow(a);
  await syncNow(b.page);
  await syncNow(a);
  for (const p of [a, b.page]) {
    await tab(p, 'Watched').click();
    await p.getByRole('link', { name: /Heat/ }).click();
    await expect(p.getByTestId('rating-mine').getByRole('button', { name: p === a ? 'Like' : "Didn't like", exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(p.getByTestId('rating-partner')).toContainText(p === a ? "Didn't like" : 'Like');
  }
});

test('rename, who am I, new space revokes the old code, leave erases', async ({ page: a, newDevice }) => {
  const oldCode = await startList(a, 'Ana');
  await addByHand(a, { title: 'Heat', year: '1995', status: 'Watched' });
  await syncNow(a);
  const b = await newDevice();
  await join(b.page, oldCode, { new: 'Luz' });
  await syncNow(b.page);
  await syncNow(a);
  const a2 = await newDevice();
  await join(a2.page, oldCode, { existing: 'Ana' });
  await tab(a2.page, 'Settings').click();
  await expect(a2.page.getByRole('button', { name: 'Ana (this device)' })).toBeVisible();

  // Rename Luz from Ana's phone; Luz's device shows the new name after sync.
  await tab(a, 'Settings').click();
  await a.getByLabel('New name for Luz').fill('Lu');
  await a.getByRole('button', { name: 'Rename Luz' }).click();
  await syncNow(a);
  await syncNow(b.page);
  await expect(b.page.getByRole('button', { name: 'Lu (this device)' })).toBeVisible();

  // New space: the old-code device gets nothing new; a device with the new code gets everything.
  await a.getByRole('button', { name: 'Start a new shared list' }).click();
  await a.getByRole('button', { name: 'Start new list' }).click();
  const newCode = (await a.getByTestId('sync-code').textContent())!;
  expect(newCode).not.toBe(oldCode);
  await tab(a, 'Watch later').click();
  await addByHand(a, { title: 'Alien', year: '1979' });
  await syncNow(a);
  await syncNow(b.page);
  await tab(b.page, 'Watch later').click();
  await expect(b.page.getByRole('link', { name: /Alien/ })).toHaveCount(0);
  const c = await newDevice();
  await join(c.page, newCode, { existing: 'Ana' });
  await expect(c.page.getByRole('link', { name: /Alien/ })).toBeVisible();
  await tab(c.page, 'Watched').click();
  await expect(c.page.getByRole('link', { name: /Heat/ })).toBeVisible();

  // Leave on b: confirm, local data and code gone; a is unaffected.
  await tab(b.page, 'Settings').click();
  await b.page.getByRole('button', { name: 'Leave the shared list' }).click();
  await expect(b.page.getByRole('button', { name: 'Export first' })).toBeVisible();
  await b.page.getByRole('button', { name: 'Leave and erase' }).click();
  await expect(b.page.getByRole('button', { name: 'Start a shared list' })).toBeVisible();
  await tab(a, 'Watch later').click();
  await expect(a.getByRole('link', { name: /Alien/ })).toBeVisible();
});

test('export, then import into a fresh device gives the same catalog; importing twice adds nothing', async ({ page: a, newDevice }) => {
  await startList(a, 'Ana');
  await addByHand(a, { title: 'Heat', year: '1995', status: 'Watched' });
  await addByHand(a, { title: 'Alien', year: '1979' });
  await tab(a, 'Watched').click();
  await a.getByRole('link', { name: /Heat/ }).click();
  await a.getByTestId('rating-mine').getByRole('button', { name: 'Like', exact: true }).click();
  await tab(a, 'Settings').click();
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Export' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^cinefilo-\d{4}-\d{2}-\d{2}\.json$/);
  const path = (await download.path());
  expect(JSON.parse(await readFile(path, 'utf8')).format).toBe('cinefilo/v1');

  const b = await newDevice();
  await startList(b.page, 'Zed');
  await tab(b.page, 'Settings').click();
  await b.page.locator('#import-file').setInputFiles(path);
  await expect(b.page.getByText(/Imported \d+ items\./)).toBeVisible();
  await tab(b.page, 'Watch later').click();
  await expect(b.page.getByRole('link', { name: /Alien/ })).toBeVisible();
  await tab(b.page, 'Watched').click();
  await b.page.getByRole('link', { name: /Heat/ }).click();
  await expect(b.page.getByTestId('rating-partner')).toContainText('Ana');
  await expect(b.page.getByTestId('rating-partner')).toContainText('Like');

  await tab(b.page, 'Settings').click();
  await b.page.locator('#import-file').setInputFiles(path);
  await expect(b.page.getByText('Imported 0 items.')).toBeVisible();
});
