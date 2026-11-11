import { expect as pwExpect } from '@playwright/test';
import { QR_PREFIX } from '../../packages/cinefilo-db/src/frozen.ts';
import { parseSyncCode, qrPayload } from '../../packages/sync/src/code.ts';
import { installFakeCamera } from '../fixtures/catalog.ts';
import { expect, openApp, startList, test } from './fixtures.ts';

test('join by scanning the QR code with the fake camera', async ({ page: a, newDevice }) => {
  const code = await startList(a, 'Ana');
  const parsed = parseSyncCode(code);
  if (!parsed.ok) throw new Error('code');

  const b = await newDevice();
  const camera = await installFakeCamera(b.page);
  await camera.showQr(qrPayload(parsed.value, QR_PREFIX));
  await openApp(b.page);
  await b.page.getByRole('button', { name: 'Join with a code' }).click();
  await b.page.getByRole('button', { name: 'Scan code' }).click();
  // Detection joins by itself, then asks who we are.
  await expect(b.page.getByLabel("I'm new")).toBeVisible({ timeout: 20_000 });
  await pwExpect.poll(() => camera.liveTracks()).toBe(0); // the camera was stopped
});

test('a QR that is not a cinefilo code is rejected; denied camera falls back to typing', async ({ newDevice }) => {
  const b = await newDevice();
  const camera = await installFakeCamera(b.page);
  await camera.showQr('https://example.com/not-a-code');
  await openApp(b.page);
  await b.page.getByRole('button', { name: 'Join with a code' }).click();
  await b.page.getByRole('button', { name: 'Scan code' }).click();
  await expect(b.page.getByRole('alert')).toHaveText(/typo|No shared list/, { timeout: 20_000 });
  await expect(b.page.getByLabel('Sync code')).toBeVisible();

  camera.deny();
  await b.page.getByRole('button', { name: 'Scan code' }).click();
  await expect(b.page.getByText('Camera permission was denied.')).toBeVisible();
  await b.page.getByRole('button', { name: 'Type the code instead' }).click();
  await expect(b.page.getByLabel('Sync code')).toBeVisible();
});
