import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, startList, tab, tapStars, test } from './fixtures.ts';
import { importCatalogue } from './seed.ts';

// cinefilo-stars 2.1-2.3: the stacked Ratings block, the partner's read-only stars and review at 390×844, both themes, screenshots.
const DIR = fileURLToPath(new URL('./__screens__/', import.meta.url));
test.use({ viewport: { width: 390, height: 844 } });

for (const [id, label] of [['beton', 'Béton'], ['willis', 'Willis']] as const) {
  test(`stars on the title screen and in the Watched list (${label})`, async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), id);
    await startList(page, 'Ana');
    await importCatalogue(page, { numbered: true });
    const shoot = async (name: string) => {
      await page.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${DIR}stars-${id}-${name}.png` });
    };

    await tab(page, 'Watched').click();
    const row = page.getByRole('link', { name: /The Brutalist/ });
    await expect(row.getByRole('img', { name: 'You: 4.5 stars' })).toHaveText('★ 4.5');
    await expect(row.getByRole('img', { name: 'Luz: 2.5 stars' })).toHaveText('★ 2.5');
    await expect(row.locator('.who')).toHaveText(['A', 'L']);
    await expect(page.getByRole('link', { name: /Back to the Future/ }).getByRole('img', { name: 'You: 3 stars' })).toBeVisible();
    await shoot('watched');

    await row.click();
    const mine = page.getByTestId('rating-mine');
    const partner = page.getByTestId('rating-partner');
    await expect(mine.getByRole('slider', { name: 'Your rating' })).toHaveAttribute('aria-valuetext', '4.5 stars');
    await expect(partner.getByRole('img', { name: 'Luz: 2.5 stars' })).toBeVisible();
    await expect(partner).toContainText('Gorgeous rooms');
    await expect(partner).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Stacked: the partner block is below the member's block and as wide.
    const m = (await mine.boundingBox())!;
    const p = (await partner.boundingBox())!;
    expect(p.y).toBeGreaterThanOrEqual(m.y + m.height);
    expect(Math.round(p.width)).toBe(Math.round(m.width));
    // Read-only stars are 16 px; the editable row is 5 x 32 px.
    expect(Math.round((await partner.locator('svg.star').first().boundingBox())!.width)).toBe(16);
    await shoot('title');

    // An unrated partner reads "not rated".
    await tab(page, 'Watch later').click();
    await page.getByRole('link', { name: /Inception/ }).click();
    await expect(page.getByTestId('rating-partner').getByRole('img', { name: 'Luz: not rated' })).toBeVisible();
    await tapStars(page.getByTestId('rating-mine').getByRole('slider', { name: 'Your rating' }), 10);
    await expect(page.getByTestId('rating-mine').getByRole('slider', { name: 'Your rating' })).toHaveAttribute('aria-valuetext', '5 stars');
  });
}
