import { fileURLToPath } from 'node:url';
import { expect, startList, tab, test } from './fixtures.ts';
import { installTmdb, saveKey } from './tmdb.ts';

const DIR = fileURLToPath(new URL('./__screens__/', import.meta.url));
test.use({ viewport: { width: 390, height: 844 } });

for (const [theme, file] of [['beton', 'search-results-beton'], ['willis', 'search-results-willis']] as const) {
  test(`search results stay readable at 390 px (${theme})`, async ({ page, context }) => {
    const tmdb = await installTmdb(context);
    await page.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), theme);
    await startList(page, 'Ana');
    await saveKey(page);
    await tab(page, 'Watch later').click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a title' });
    await sheet.getByLabel('Search TMDB').fill('Ebenezer');
    await sheet.getByRole('button', { name: 'Search', exact: true }).click();
    const rows = sheet.getByRole('list', { name: 'Search results' }).getByRole('listitem');
    await expect(rows).toHaveCount(3);

    for (let i = 0; i < 3; i++) {
      const row = rows.nth(i);
      const name = row.locator('.name');
      const box = (await name.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(150);
      const lines = await name.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
      expect(lines).toBeLessThanOrEqual(2);
      const btn = row.getByRole('button');
      const b = (await btn.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeLessThanOrEqual(120);
    }

    await expect(sheet.getByRole('button', { name: 'Add Ebenezer (2026)' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Add Ebenezer (1998)' })).toBeVisible();

    const img = rows.nth(0).locator('img');
    await expect(img).toHaveAttribute('src', /^https:\/\/image\.tmdb\.org\/t\/p\/w92\//);
    expect(await img.getAttribute('src')).not.toContain('api_key');
    await expect(rows.nth(0).getByTestId('cover')).toHaveCount(0);
    await expect(rows.nth(1).locator('img')).toHaveCount(0);
    await expect(rows.nth(1).getByTestId('cover')).toBeVisible();

    await rows.nth(2).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}${file}.png` });
    expect(tmdb.requests.filter((r) => r.hasKey).every((r) => r.host === 'api.themoviedb.org')).toBe(true);
  });
}
