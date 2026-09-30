import { expect, test } from '@playwright/test';
import { addBook, openApp, openLogSheet } from './helpers.ts';

test.describe('native shell (reduced motion)', () => {
  test('large title collapses into the bar on scroll; tab bar has icons and labels', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await openApp(page, '#/settings');
    const bar = page.locator('header.bar');
    await expect(bar).toHaveAttribute('data-title', 'Settings');
    await expect(bar).not.toHaveAttribute('data-compact', /.*/);
    // The compact title is CSS content only: exactly one "Settings" heading, no extra text node.
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toHaveCount(1);
    await expect(page.locator('header.bar').getByText('Settings')).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar).toHaveAttribute('data-compact', /.*/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar).not.toHaveAttribute('data-compact', /.*/);

    const tabs = page.getByRole('navigation', { name: 'Main' });
    for (const name of ['Home', 'Library', 'Add', 'Stats', 'Settings']) {
      const tab = tabs.getByRole('link', { name, exact: true });
      await expect(tab).toBeVisible();
      await expect(tab.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    }
  });

  test('a book shows "Back to Library", which returns to Library', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Dune', author: 'Frank Herbert', pages: 400 });
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('link', { name: 'Dune' }).click();
    await expect(page).toHaveURL(/#\/book\//);
    const back = page.getByRole('link', { name: 'Back to Library' });
    await expect(back).toHaveText('‹ Library');
    await back.click();
    await expect(page).toHaveURL(/#\/library$/);
    await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Back to/ })).toHaveCount(0);
  });

  test('the log sheet has a grabber and locks page scroll', async ({ page }) => {
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 400 });
    const sheet = await openLogSheet(page);
    const grabberWidth = await sheet.evaluate((el) => getComputedStyle(el, '::before').width);
    expect(grabberWidth).toBe('36px');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
  });

  test('inputs are at least 17px; controls are not selectable', async ({ page }) => {
    await openApp(page, '#/add');
    const size = await page.getByLabel('Title').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(17);
    const select = await page.getByRole('button', { name: 'Save book' }).evaluate((el) => getComputedStyle(el).userSelect);
    expect(select).toBe('none');
    const tabSelect = await page.getByRole('link', { name: 'Library', exact: true }).evaluate((el) => getComputedStyle(el).userSelect);
    expect(tabSelect).toBe('none');
  });
});

test.describe('view transitions (motion allowed)', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('the push to a book runs a view transition', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __vt: number };
      w.__vt = 0;
      const orig = document.startViewTransition?.bind(document);
      if (orig) {
        document.startViewTransition = ((cb?: () => void) => {
          w.__vt++;
          return orig(cb);
        }) as typeof document.startViewTransition;
      }
    });
    await openApp(page);
    await addBook(page, { title: 'Dune', pages: 400 });
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    const before = await page.evaluate(() => (window as unknown as { __vt: number }).__vt);
    await page.getByRole('link', { name: 'Dune' }).click();
    await expect(page.getByRole('link', { name: 'Back to Library' })).toBeVisible();
    const after = await page.evaluate(() => (window as unknown as { __vt: number }).__vt);
    expect(after).toBeGreaterThan(before);
  });
});
