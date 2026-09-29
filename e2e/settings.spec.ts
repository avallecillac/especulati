import { expect, test } from '@playwright/test';
import { openApp } from './helpers.ts';

test('Settings shows storage persistence, device id and schema version (FR-013)', async ({ page }) => {
  await openApp(page, '#/settings');
  await expect(page.getByText(/Storage: (persistent|not persistent)/)).toBeVisible();
  await expect(page.getByTestId('device-id')).toHaveText(/^[0-9a-f-]{36}$/);
  await expect(page.getByText('Schema version 2')).toBeVisible();
  await expect(page.getByTestId('app-version')).toHaveText(/^Readerlog \d+\.\d+\.\d+$/);
});
