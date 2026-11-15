import type { Page } from '@playwright/test';
import { addByHand, expect, openApp, startList, tab, test } from './fixtures.ts';

async function joinCode(page: Page, code: string) {
  await openApp(page);
  await page.getByRole('button', { name: 'Join with a code' }).click();
  await page.getByLabel('Sync code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
}

async function syncNow(page: Page) {
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
}

test('a duplicate member with no activity is removed on one device and disappears on the other', async ({ page: a, newDevice }) => {
  const code = await startList(a, 'Ana');
  await addByHand(a, { title: 'Heat', year: '1995', status: 'Watched' });
  await syncNow(a);

  const b = await newDevice();
  await joinCode(b.page, code);
  await b.page.getByLabel("I'm new").fill('Luz');
  await b.page.getByRole('button', { name: 'Create me' }).click();
  await expect(b.page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await syncNow(b.page);

  // A third phone creates a second Ana (the duplicate) instead of picking the real one.
  const c = await newDevice();
  await joinCode(c.page, code);
  await c.page.getByLabel("I'm new").fill('Ana');
  await c.page.getByRole('button', { name: 'Create me' }).click();
  await expect(c.page.getByText('There is already a Ana. Is that you?')).toBeVisible();
  await c.page.getByRole('button', { name: 'No, create a new one' }).click();
  await expect(c.page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await syncNow(c.page);

  await syncNow(a);
  await tab(a, 'Settings').click();
  // The counts tell them apart: the real Ana added Heat, the duplicate has nothing.
  await expect(a.getByText('1 added')).toBeVisible();
  await expect(a.getByText('No activity yet')).toHaveCount(2); // Luz and the duplicate Ana
  await expect(a.getByRole('button', { name: /^Remove / })).toHaveCount(2);
  await expect(a.getByRole('button', { name: 'Ana (this device)' })).toBeVisible();
  await expect(a.getByRole('button', { name: 'Remove Ana' })).toHaveCount(1); // none for this device's own Ana

  await a.getByRole('button', { name: 'Remove Ana' }).click();
  const sheet = a.getByRole('alertdialog', { name: 'Remove Ana?' });
  await expect(sheet.getByText('They have no activity.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(a.getByText('Removed Ana.')).toBeVisible();
  await expect(a.getByRole('button', { name: 'Remove Ana' })).toHaveCount(0);
  await syncNow(a);

  // The real partner's phone no longer lists the duplicate.
  await syncNow(b.page);
  await expect(b.page.getByRole('button', { name: "I'm Ana" })).toHaveCount(1);
  await expect(b.page.getByRole('button', { name: 'Luz (this device)' })).toBeVisible();

  // The phone acting as the removed Ana is asked who it is, listing the remaining members.
  await tab(c.page, 'Settings').click();
  await c.page.getByRole('button', { name: 'Sync now' }).click();
  await expect(c.page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await expect(c.page.getByRole('button', { name: "I'm Ana" })).toHaveCount(1);
  await expect(c.page.getByRole('button', { name: "I'm Luz" })).toBeVisible();
  await expect(c.page.getByRole('button', { name: 'Start a shared list' })).toHaveCount(0);
  await c.page.getByRole('button', { name: "I'm Ana" }).click();
  await expect(c.page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
});

test('Settings lists counts and offers no Remove for this device; the sheet warns when a member has activity', async ({ page: a, newDevice }) => {
  const code = await startList(a, 'Ana');
  await addByHand(a, { title: 'Heat', year: '1995', status: 'Watched' });
  await syncNow(a);
  const b = await newDevice();
  await joinCode(b.page, code);
  await b.page.getByLabel("I'm new").fill('Luz');
  await b.page.getByRole('button', { name: 'Create me' }).click();
  await expect(b.page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await syncNow(b.page);
  await syncNow(a);
  await tab(a, 'Settings').click();
  await expect(a.getByRole('button', { name: 'Ana (this device)' })).toBeVisible();
  await expect(a.getByRole('button', { name: 'Remove Ana' })).toHaveCount(0);
  await expect(a.getByRole('button', { name: 'Remove Luz' })).toBeVisible();

  // Luz's phone: Ana has activity, so the sheet says so.
  await tab(b.page, 'Settings').click();
  await expect(b.page.getByText('1 added')).toBeVisible();
  await b.page.getByRole('button', { name: 'Remove Ana' }).click();
  const sheet = b.page.getByRole('alertdialog', { name: 'Remove Ana?' });
  await expect(sheet.getByText('Ana has 1 added.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await expect(b.page.getByRole('button', { name: 'Remove Ana' })).toBeVisible();
});

test('"Create me" with an existing name asks first; "Yes" picks that member', async ({ page: a, newDevice }) => {
  const code = await startList(a, 'Vivi');
  await syncNow(a);
  const b = await newDevice();
  await joinCode(b.page, code);
  await b.page.getByLabel("I'm new").fill('  vívi ');
  await b.page.getByRole('button', { name: 'Create me' }).click();
  await expect(b.page.getByText('There is already a Vivi. Is that you?')).toBeVisible();
  await b.page.getByRole('button', { name: "Yes, I'm Vivi" }).click();
  await expect(b.page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await tab(b.page, 'Settings').click();
  await expect(b.page.getByRole('button', { name: 'Vivi (this device)' })).toBeVisible();
  await expect(b.page.getByRole('button', { name: /^I'm / })).toHaveCount(0);
});
