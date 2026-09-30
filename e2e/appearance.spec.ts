import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers.ts';

const html = (page: Page) => page.locator('html');
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const bodyImage = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundImage);
const metaColor = (page: Page) => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'));
const radio = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name, exact: true });

test.describe('US3: appearance', () => {
  test('picking Patriarca changes the page at once; reload keeps it with no flash', async ({ page }) => {
    // Record the theme and the painted colour on the first frame of every load.
    await page.addInitScript(() => {
      const w = window as unknown as { __first?: { theme: string | undefined; bg: string }[] };
      w.__first = [];
      document.addEventListener('DOMContentLoaded', () => {
        requestAnimationFrame(() => {
          w.__first!.push({ theme: document.documentElement.dataset['theme'], bg: getComputedStyle(document.body).backgroundColor });
        });
      });
    });

    await openApp(page, '#/settings');
    const group = page.getByRole('radiogroup', { name: 'Appearance' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await expect(radio(page, 'Automatic')).toHaveAttribute('aria-checked', 'true');
    await expect(html(page)).toHaveAttribute('data-theme', 'macondo');
    const light = await bodyBg(page);
    const lightMeta = await metaColor(page);
    // Macondo has the paper texture; Patriarca has none to draw (R7).
    expect(await bodyImage(page)).toContain('url(');

    await radio(page, 'Patriarca').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'patriarca');
    await expect(radio(page, 'Patriarca')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(page, 'Automatic')).toHaveAttribute('aria-checked', 'false');
    const dark = await bodyBg(page);
    expect(dark).not.toBe(light);
    expect(await metaColor(page)).not.toBe(lightMeta);
    expect(await bodyImage(page)).not.toContain('url(');

    await page.reload();
    await expect(page.getByTestId('ready')).toBeAttached();
    await expect(html(page)).toHaveAttribute('data-theme', 'patriarca');
    await expect(radio(page, 'Patriarca')).toHaveAttribute('aria-checked', 'true');
    // The first frame after the reload was already dark: no flash of the light theme.
    const first = await page.evaluate(() => (window as unknown as { __first: { theme: string; bg: string }[] }).__first);
    expect(first.at(-1)).toEqual({ theme: 'patriarca', bg: dark });
  });

  test('Automatic follows the system colour scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page, '#/settings');
    await expect(html(page)).toHaveAttribute('data-theme', 'patriarca');
    await expect(radio(page, 'Automatic')).toHaveAttribute('aria-checked', 'true');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html(page)).toHaveAttribute('data-theme', 'macondo');

    // An explicit choice ignores the system.
    await radio(page, 'Macondo').click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'macondo');

    await radio(page, 'Automatic').click();
    await expect(html(page)).toHaveAttribute('data-theme', 'patriarca');
  });

  test('the rows work from the keyboard', async ({ page }) => {
    await openApp(page, '#/settings');
    await radio(page, 'Automatic').focus();
    await page.keyboard.press('ArrowDown');
    await expect(radio(page, 'Macondo')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(page, 'Macondo')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(html(page)).toHaveAttribute('data-theme', 'patriarca');
  });
});
