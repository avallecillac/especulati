import type { Page } from '@playwright/test';
import { formatSyncCode, parseSyncCode, qrPayload } from '../packages/sync/src/code.ts';
import { test, expect } from './fixtures/relay.ts';
import { addBook, openApp } from './helpers.ts';

const CODE = /^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/;

/** Settings → Sync → Turn on sync. Returns the text code shown. */
async function turnOn(page: Page): Promise<string> {
  await openApp(page, '#/settings');
  await page.getByRole('link', { name: 'Sync' }).click();
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(page.getByRole('img', { name: 'Sync code QR' })).toBeVisible();
  const code = (await page.getByTestId('sync-code').textContent()) ?? '';
  return code.trim();
}

/** A well-formed code whose space was never created on the relay. */
const unknownCode = () => formatSyncCode(Uint8Array.from({ length: 32 }, (_, i) => 200 - i));

test('turn on, then join by pasting the code: B shows the books of A within 10 s (SC-001)', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  await openApp(a.page);
  await addBook(a.page, { title: 'Dune', start: false });
  await addBook(a.page, { title: 'Emma', start: false });

  const code = await turnOn(a.page);
  expect(code).toMatch(CODE);
  await expect(a.page.getByText(/password manager/i)).toBeVisible();
  await expect(a.page.getByText(/only way to recover/i)).toBeVisible();

  // B: count every click and fill from Settings to joined.
  let steps = 0;
  await openApp(b.page, '#/settings');
  await b.page.getByRole('link', { name: 'Sync' }).click();
  steps++;
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  steps++;
  await b.page.getByLabel('Sync code').fill(code);
  steps++;
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  steps++;
  expect(steps).toBeLessThanOrEqual(5);

  await expect(b.page.getByRole('button', { name: 'Show code' })).toBeVisible({ timeout: 10_000 });
  await b.page.goto('/#/library');
  await expect(b.page.getByText('Dune')).toBeVisible({ timeout: 10_000 });
  await expect(b.page.getByText('Emma')).toBeVisible();
});

test('show code again displays the same code', async ({ page }) => {
  await openApp(page);
  const code = await turnOn(page);
  await page.reload();
  await page.getByRole('button', { name: 'Show code' }).click();
  await expect(page.getByRole('img', { name: 'Sync code QR' })).toBeVisible();
  await expect(page.getByTestId('sync-code')).toHaveText(code);
});

test('a typo is reported and changes nothing; an unknown space is reported', async ({ twoDevices, relay }) => {
  const { a, b } = twoDevices;
  await openApp(a.page);
  const code = await turnOn(a.page);

  await openApp(b.page, '#/settings/sync');
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  const typo = (code[0] === '2' ? '3' : '2') + code.slice(1);
  await b.page.getByLabel('Sync code').fill(typo);
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.page.getByRole('alert')).toHaveText('That code has a typo');
  // Still not joined: the joining form is still there.
  await expect(b.page.getByLabel('Sync code')).toBeVisible();

  await b.page.getByLabel('Sync code').fill(unknownCode());
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(b.page.getByRole('alert')).toHaveText('No sync space found for this code');
  await expect(b.page.getByLabel('Sync code')).toBeVisible();

  // Reload: B is still off.
  await b.page.reload();
  await expect(b.page.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
  expect(relay.requests().filter((r) => r.startsWith('POST'))).toEqual([]);
});

test('join by scanning the QR code with the fake camera', async ({ twoDevices }) => {
  const { a, b } = twoDevices;
  await openApp(a.page);
  await addBook(a.page, { title: 'Dune', start: false });
  const code = await turnOn(a.page);
  const parsed = parseSyncCode(code);
  if (!parsed.ok) throw new Error('code');

  await b.camera.showQr(qrPayload(parsed.value));
  await openApp(b.page, '#/settings/sync');
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await b.page.getByRole('button', { name: 'Scan code' }).click();
  await expect(b.page.getByRole('button', { name: 'Show code' })).toBeVisible({ timeout: 20_000 });
  await b.page.goto('/#/library');
  await expect(b.page.getByText('Dune')).toBeVisible({ timeout: 10_000 });
});
