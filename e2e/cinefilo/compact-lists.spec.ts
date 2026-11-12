import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, startList, tab, test } from './fixtures.ts';
import { importCatalogue, importSeed } from './seed.ts';

// cinefilo-compact-lists: search, the compact header, the kept scroll position, smaller controls. 390×844 like a phone.
const DIR = fileURLToPath(new URL('./__screens__/', import.meta.url));
test.use({ viewport: { width: 390, height: 844 } });

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search titles' });
const rows = (page: Page) => page.locator('ul.rows a.row');
const tiles = (page: Page) => page.locator('ul.grid a.tile');

async function catalogue(page: Page): Promise<void> {
  await startList(page, 'Ana');
  await importCatalogue(page, { numbered: true });
  await tab(page, 'Watched').click();
  await expect(page.getByRole('link', { name: /The Brutalist/ })).toBeVisible();
}

test('search filters the list by title, ignoring case and accents, offline, with Clear', async ({ page, context }) => {
  await startList(page, 'Ana');
  await importSeed(page, [
    { name: 'The Godfather', mine: 9, partner: 9 },
    { name: 'Amélie', mine: 9, partner: null },
    { name: 'Alien', mine: null, partner: null },
  ]);
  await context.setOffline(true);
  await tab(page, 'Watched').click();
  await expect(rows(page)).toHaveCount(3);

  await search(page).fill('godf');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('The Godfather');

  await search(page).fill('AMELIE');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Amélie');

  await search(page).fill('zzz');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('No titles match “zzz”.')).toBeVisible();

  const clear = page.getByRole('button', { name: 'Clear search' });
  await clear.click();
  await expect(search(page)).toHaveValue('');
  await expect(rows(page)).toHaveCount(3);
  await expect(clear).toHaveCount(0);

  // The grid searches the same way, and there is no Filter button any more.
  await search(page).fill('am');
  await page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Grid' }).click();
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toHaveAttribute('aria-label', 'Amélie');
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
});

test('the header is compact, and the partner list still says view only', async ({ page }) => {
  await catalogue(page);
  const first = (await rows(page).first().boundingBox())!;
  expect(first.y).toBeLessThan(220);
  const swtch = (await page.getByRole('radiogroup', { name: 'List' }).boundingBox())!;
  expect(swtch.height).toBeLessThanOrEqual(36);

  await expect(page.getByTestId('whose')).toHaveText('Together');
  expect((await page.getByTestId('whose').boundingBox())!.width).toBeLessThanOrEqual(1); // visually hidden, still in the DOM
  await page.getByRole('radiogroup', { name: 'List' }).getByRole('radio', { name: 'Luz' }).click();
  await expect(page.getByTestId('whose')).toHaveText("Luz's list · view only");
  await expect(page.getByTestId('whose')).toBeInViewport();
  await page.getByRole('radiogroup', { name: 'List' }).getByRole('radio', { name: 'Together' }).click();

  // The order icons are Together Watched only.
  await expect(page.getByRole('radiogroup', { name: 'Watched order' })).toBeVisible();
  await tab(page, 'Watch later').click();
  await expect(page.getByRole('radiogroup', { name: 'Watched order' })).toHaveCount(0);
  await expect(search(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
});

test('the list header has no filter, and rows show each member\'s stars', async ({ page }) => {
  await startList(page, 'Ana');
  await importSeed(page, [{ name: 'Heat', mine: 9, partner: 1 }, { name: 'Alien', mine: 2, partner: null }]);
  await tab(page, 'Watched').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
  const heat = page.getByRole('link', { name: /Heat/ });
  await expect(heat.getByRole('img', { name: 'You: 4.5 stars' })).toHaveText('★ 4.5');
  await expect(heat.getByRole('img', { name: 'Luz: 0.5 stars' })).toBeVisible();
  const alien = page.getByRole('link', { name: /Alien/ });
  await expect(alien.getByRole('img', { name: 'You: 1 star' })).toBeVisible();
  await expect(alien.getByRole('img', { name: 'Luz: not rated' })).toHaveText('★ –');
});

for (const mode of ['list', 'grid'] as const) {
  test(`going back from a title keeps the scroll position and search (${mode})`, async ({ page }) => {
    await startList(page, 'Ana');
    await importSeed(page, Array.from({ length: 45 }, (_, i) => ({ name: `Film ${String(i + 1).padStart(2, '0')}`, mine: 9, partner: 9 })));
    await tab(page, 'Watched').click();
    if (mode === 'grid') await page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Grid' }).click();
    const items = mode === 'grid' ? tiles(page) : rows(page);
    await expect(items).toHaveCount(45);

    await search(page).fill('film');
    await expect(items).toHaveCount(45);

    await page.evaluate(() => window.scrollTo(0, 1100));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const before = await page.evaluate(() => window.scrollY);
    // Open a title that is fully on screen.
    const index = await items.evaluateAll((els) => els.findIndex((el) => { const r = el.getBoundingClientRect(); return r.top > 150 && r.bottom < 700; }));
    expect(index).toBeGreaterThan(0);
    await items.nth(index).click();
    await expect(page.getByRole('link', { name: 'Back' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    await page.getByRole('link', { name: 'Back' }).click();
    await expect(items).toHaveCount(45);
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
    await expect(search(page)).toHaveValue('film');
    // It stays put: no later re-restore fights the member.
    await page.waitForTimeout(300);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
  });
}

for (const [id, label] of [['beton', 'Béton'], ['willis', 'Willis']] as const) {
  test(`smaller controls and compact title screen in ${label}`, async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), id);
    await catalogue(page);
    const shoot = async (name: string) => {
      await page.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${DIR}compact-${id}-${name}.png` });
    };

    // Controls: 40 px shared height, none under 32 px.
    const add = (await page.getByRole('button', { name: 'Add', exact: true }).boundingBox())!;
    expect(add.height).toBeGreaterThanOrEqual(32);
    expect(add.height).toBeLessThanOrEqual(40);
    // Header: the first row starts within the top 200 px, and the tools row has no Filter.
    expect((await rows(page).first().boundingBox())!.y).toBeLessThanOrEqual(200);
    await expect(page.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
    await shoot('watched');

    await page.getByRole('link', { name: /The Brutalist/ }).click();
    const mine = page.getByTestId('rating-mine');
    await expect(mine).toBeVisible();
    // One slider of five 32 px stars; the review box starts at two lines.
    const slider = mine.getByRole('slider', { name: 'Your rating' });
    await expect(slider).toHaveAttribute('aria-valuetext', '4.5 stars');
    const sb = (await slider.boundingBox())!;
    expect(Math.round(sb.width)).toBe(160);
    expect(Math.round(sb.height)).toBe(32);
    await expect(mine.getByLabel('Your review')).toHaveAttribute('rows', '2');
    await expect(page.getByTestId('rating-partner')).toContainText('Gorgeous rooms');
    await expect(page.getByTestId('rating-partner')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Pinned sizes stay.
    const back = (await page.getByRole('link', { name: 'Back' }).boundingBox())!;
    expect([Math.round(back.width), Math.round(back.height)]).toEqual([44, 44]);
    expect(Math.round((await page.getByTestId('cover').boundingBox())!.height)).toBe(200);
    await shoot('title');
  });
}
