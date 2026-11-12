import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, startList, tab, test } from './fixtures.ts';
import { importCatalogue } from './seed.ts';

// cinefilo-feedback-1 groups 1 and 2: watch order, reviews first, list/grid. 390×844 like a phone.
const DIR = fileURLToPath(new URL('./__screens__/', import.meta.url));
test.use({ viewport: { width: 390, height: 844 } });

const layout = (page: Page) => page.getByRole('radiogroup', { name: 'Layout' });
const order = (page: Page) => page.getByRole('radiogroup', { name: 'Watched order' });
const names = (page: Page) => page.locator('ul.rows .name').allTextContents();

async function ready(page: Page, opts: { numbered?: boolean } = {}): Promise<void> {
  await startList(page, 'Ana');
  await importCatalogue(page, opts);
  await tab(page, 'Watched').click();
}

test('Watched shows each title\'s number, newest first, and "From #1" is remembered on the device', async ({ page }) => {
  await ready(page, { numbered: true });
  await expect(page.getByRole('link', { name: /The Brutalist/ })).toBeVisible();
  expect((await names(page)).map((n) => n.replace(/\s+/g, ' ').trim())).toEqual(['#3 The Brutalist', '#2 The Godfather', '#1 Back to the Future']);
  await expect(order(page).getByRole('radio', { name: 'Newest first' })).toHaveAttribute('aria-checked', 'true');
  // cinefilo-compact-lists D4: two small arrow icons, named by aria-label and title.
  for (const name of ['Newest first', 'From #1']) {
    const radio = order(page).getByRole('radio', { name });
    await expect(radio.locator('svg')).toHaveCount(1);
    await expect(radio).toHaveAttribute('title', name);
    await expect(radio).toHaveText('');
    const box = (await radio.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(32);
  }

  await order(page).getByRole('radio', { name: 'From #1' }).click();
  expect((await names(page)).map((n) => n.slice(0, 2))).toEqual(['#1', '#2', '#3']);
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await tab(page, 'Watched').click();
  await expect(order(page).getByRole('radio', { name: 'From #1' })).toHaveAttribute('aria-checked', 'true');
  expect((await names(page)).map((n) => n.slice(0, 2))).toEqual(['#1', '#2', '#3']);
  expect(await page.evaluate(() => localStorage.getItem('cinefilo.watchedOrder'))).toBe('first');

  // Other lists carry no numbers, and a title marked watched now takes the next number.
  await tab(page, 'Watch later').click();
  await expect(page.locator('ul.rows .num')).toHaveCount(0);
  await page.getByRole('link', { name: /Inception/ }).click();
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Watched' }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(order(page).getByRole('radio', { name: 'From #1' })).toHaveAttribute('aria-checked', 'true');
  expect((await names(page)).map((n) => n.slice(0, 2))).toEqual(['#1', '#2', '#3', '#4']);
  await expect(page.locator('ul.rows .name').last()).toContainText('Inception');

  // Leaving Watched renumbers the rest.
  await page.getByRole('link', { name: /The Godfather/ }).click();
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Watch later' }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Watch later' })).toBeVisible();
  await tab(page, 'Watched').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Watched' })).toBeVisible();
  await expect(page.getByRole('link', { name: /The Godfather/ })).toHaveCount(0);
  expect((await names(page)).map((n) => n.replace(/\s+/g, ' ').trim())).toEqual(['#1 Back to the Future', '#2 The Brutalist', '#3 Inception']);
});

test('the title screen shows both reviews before Lists, and rows carry a labelled review mark', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('img', { name: 'Reviewed by both' })).toHaveCount(2); // The Brutalist, The Godfather
  const row = (name: RegExp) => page.getByRole('link', { name });
  await expect(row(/Back to the Future/).getByRole('img', { name: 'Reviewed by Luz' })).toBeVisible();
  await tab(page, 'Watch later').click();
  await expect(page.getByRole('img', { name: /Reviewed by/ })).toHaveCount(0);

  await tab(page, 'Watched').click();
  await row(/The Brutalist/).click();
  const partner = page.getByTestId('rating-partner');
  await expect(partner).toContainText('Gorgeous rooms');
  await expect(partner).toBeInViewport({ ratio: 1 }); // no scrolling at 390×844
  await expect(page.getByTestId('rating-mine')).toBeInViewport();
  const ratings = await page.getByRole('heading', { name: 'Ratings' }).boundingBox();
  const lists = await page.getByRole('heading', { name: 'Lists' }).boundingBox();
  expect(ratings!.y).toBeLessThan(lists!.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the grid: three 2:3 tiles per row, remembered across reload and lists, tiles open titles, no poster means a generated cover', async ({ page }) => {
  await ready(page, { numbered: true });
  await expect(layout(page).getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  await layout(page).getByRole('radio', { name: 'Grid' }).click();
  await expect(page.locator('ul.grid')).toBeVisible();
  const tiles = page.locator('ul.grid a.tile');
  await expect(tiles).toHaveCount(3);
  const boxes = await Promise.all([0, 1, 2].map((i) => tiles.nth(i).boundingBox()));
  expect(new Set(boxes.map((b) => Math.round(b!.y))).size).toBe(1); // one row of three
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  for (const b of boxes) expect(b!.height / b!.width).toBeCloseTo(1.5, 1);
  expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(390);
  await expect(tiles.first().getByTestId('cover')).toBeVisible();
  await expect(page.getByRole('link', { name: 'The Brutalist', exact: true }).getByText('#3')).toBeVisible();
  await expect(page.getByRole('link', { name: 'The Brutalist', exact: true }).getByRole('img', { name: 'Reviewed by both' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cinefilo.layout'))).toBe('grid');

  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await tab(page, 'Watching').click();
  await expect(page.locator('ul.grid')).toBeVisible();
  await expect(layout(page).getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('link', { name: 'The Bear', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The Bear' })).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();
  await layout(page).getByRole('radio', { name: 'List' }).click();
  await expect(page.locator('ul.rows')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cinefilo.layout'))).toBeNull();
});

for (const [id, label] of [['beton', 'Béton'], ['willis', 'Willis']] as const) {
  test(`screens in ${label}`, async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), id);
    await ready(page, { numbered: true });
    const shoot = async (name: string) => {
      await page.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${DIR}feedback-${id}-${name}.png` });
    };
    await expect(page.getByRole('link', { name: /The Brutalist/ })).toBeVisible();
    await shoot('watched');
    await layout(page).getByRole('radio', { name: 'Grid' }).click();
    await expect(page.locator('ul.grid')).toBeVisible();
    await shoot('grid');
    await page.getByRole('link', { name: 'The Godfather', exact: true }).click();
    await expect(page.getByTestId('rating-partner')).toBeVisible();
    await shoot('title');
  });
}
