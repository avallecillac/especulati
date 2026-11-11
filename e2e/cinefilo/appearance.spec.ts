import type { Page } from '@playwright/test';
import { expect, openApp, startList, tab, test } from './fixtures.ts';

const html = (page: Page) => page.locator('html');
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const metaColor = (page: Page) => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'));
const appearance = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name, exact: true });
const covers = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Covers' }).getByRole('radio', { name, exact: true });

test('Willis picked in light mode survives a reload with no flash (theme set before DOMContentLoaded)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    const w = window as unknown as { __first?: { theme: string | undefined; early: string | undefined; bg: string }[]; __early?: string };
    w.__first = [];
    // The pre-paint script runs in <head>, so by DOMContentLoaded the theme is set and no module ran yet.
    document.addEventListener('DOMContentLoaded', () => {
      const early = document.documentElement.dataset['theme'];
      requestAnimationFrame(() => {
        w.__first!.push({ theme: document.documentElement.dataset['theme'], early, bg: getComputedStyle(document.body).backgroundColor });
      });
    });
  });

  await startList(page, 'Ana');
  await tab(page, 'Settings').click();
  await expect(appearance(page, 'Automatic')).toHaveAttribute('aria-checked', 'true');
  await expect(html(page)).toHaveAttribute('data-theme', 'beton');
  const light = await bodyBg(page);
  const lightMeta = await metaColor(page);

  await appearance(page, 'Willis').click();
  await expect(html(page)).toHaveAttribute('data-theme', 'willis');
  const dark = await bodyBg(page);
  expect(dark).not.toBe(light);
  expect(await metaColor(page)).not.toBe(lightMeta);

  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await expect(appearance(page, 'Willis')).toHaveAttribute('aria-checked', 'true');
  const first = await page.evaluate(() => (window as unknown as { __first: { theme: string; early: string; bg: string }[] }).__first);
  expect(first.at(-1)).toEqual({ theme: 'willis', early: 'willis', bg: dark });
});

test('Automatic follows the colour scheme without a reload; a fixed choice ignores it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await expect(html(page)).toHaveAttribute('data-theme', 'willis');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html(page)).toHaveAttribute('data-theme', 'beton');

  await startList(page, 'Ana');
  await tab(page, 'Settings').click();
  await appearance(page, 'Béton').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html(page)).toHaveAttribute('data-theme', 'beton');
  await appearance(page, 'Automatic').click();
  await expect(html(page)).toHaveAttribute('data-theme', 'willis');
});

test('appearance controls are radios of at least 44 px', async ({ page }) => {
  await startList(page, 'Ana');
  await tab(page, 'Settings').click();
  for (const name of ['Automatic', 'Béton', 'Willis']) {
    const box = await appearance(page, name).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  for (const name of ['Generated', 'TMDB posters']) {
    const box = await covers(page, name).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(covers(page, 'TMDB posters')).toHaveAttribute('aria-checked', 'true');
  await covers(page, 'Generated').click();
  await expect(covers(page, 'Generated')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('cinefilo.covers'))).toBe('generated');
  await page.reload();
  await expect(covers(page, 'Generated')).toHaveAttribute('aria-checked', 'true');
});

test('the choice is device-local: not in the export, and it writes no synced ops', async ({ page, relay }) => {
  await startList(page, 'Ana');
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(() => relay.requests().length).toBeGreaterThan(0);
  const batchesBefore = relay.store.dumpAll().length;

  await appearance(page, 'Willis').click();
  await covers(page, 'TMDB posters').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('Last synced');
  expect(relay.store.dumpAll().length).toBe(batchesBefore);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const path = await (await download).path();
  const exported = await (await import('node:fs/promises')).readFile(path, 'utf8');
  expect(exported).not.toMatch(/willis|appearance|cinefilo\.covers|posters/i);
});
