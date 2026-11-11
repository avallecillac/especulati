import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, openApp, startList, tab, test } from './fixtures.ts';
import { importCatalogue } from './seed.ts';

// personal-lists 3.5: one capture per new screen and theme at 390×844 for the main session's review (not committed).
const DIR = fileURLToPath(new URL('./__screens__/', import.meta.url));
test.use({ viewport: { width: 390, height: 844 } });

async function shoot(page: Page, theme: string, name: string): Promise<void> {
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${DIR}personal-${theme}-${name}.png` });
}

async function syncNow(page: Page) {
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
}

const switchTo = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'List' }).getByRole('radio', { name, exact: true }).click();
const mineGroup = (page: Page) => page.getByRole('radiogroup', { name: 'Your status' });

for (const [id, label] of [['beton', 'Béton'], ['willis', 'Willis']] as const) {
  test(`personal lists in ${label}`, async ({ page: a, newDevice }) => {
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });
    await a.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), id);
    const code = await startList(a, 'Ana');
    await importCatalogue(a);
    await syncNow(a);

    // Luz's phone: her own list, and a recommendation for Ana.
    const { page: b, context } = await newDevice();
    await context.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), id);
    await openApp(b);
    await b.getByRole('button', { name: 'Join with a code' }).click();
    await b.getByLabel('Sync code').fill(code);
    await b.getByRole('button', { name: 'Join', exact: true }).click();
    await b.getByRole('button', { name: "I'm Luz" }).click();
    await expect(b.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await tab(b, 'Watching').click();
    for (const [name, status, nexts] of [['The Bear', 'Watching', 2], ['Better Call Saul', 'Watching', 1]] as const) {
      await b.getByRole('link', { name: new RegExp(name) }).click();
      await mineGroup(b).getByRole('radio', { name: status }).click();
      for (let i = 0; i < nexts; i++) await b.getByRole('button', { name: 'Next season (you)' }).click();
      await b.getByRole('link', { name: 'Back' }).click();
    }
    await tab(b, 'Watched').click();
    await b.getByRole('link', { name: /The Brutalist/ }).click();
    await mineGroup(b).getByRole('radio', { name: 'Watched', exact: true }).click();
    await b.getByRole('link', { name: 'Back' }).click();
    await b.getByRole('link', { name: /The Godfather/ }).click();
    await b.getByRole('button', { name: 'Recommend to Ana' }).click();
    await syncNow(b);

    // Ana's phone: a few of her own, then the screens.
    await syncNow(a);
    await tab(a, 'Watching').click();
    await a.getByRole('link', { name: /Better Call Saul/ }).click();
    await mineGroup(a).getByRole('radio', { name: 'Watching' }).click();
    for (let i = 0; i < 2; i++) await a.getByRole('button', { name: 'Next season (you)' }).click();
    await a.getByRole('link', { name: 'Back' }).click();
    await a.getByRole('link', { name: /The Simpsons/ }).click();
    await mineGroup(a).getByRole('radio', { name: 'Watching' }).click();
    await a.getByRole('button', { name: 'Next season (you)' }).click();
    await a.getByRole('link', { name: 'Back' }).click();
    await tab(a, 'Watch later').click();
    await a.getByRole('link', { name: /Inception/ }).click();
    await mineGroup(a).getByRole('radio', { name: 'Watch later' }).click();
    await a.getByRole('link', { name: 'Back' }).click();
    await syncNow(a);

    await tab(a, 'Watch later').click();
    await expect(a.getByRole('link', { name: /Inception/ })).toBeVisible();
    await shoot(a, id, 'together');

    await switchTo(a, 'Ana');
    await expect(a.getByText('Recommended by Luz')).toBeVisible();
    await expect(a.getByRole('link', { name: /Inception/ })).toBeVisible();
    await shoot(a, id, 'mine');

    await tab(a, 'Watching').click();
    await switchTo(a, 'Luz');
    await expect(a.getByRole('link', { name: /The Bear.*Season 2/ })).toBeVisible();
    await shoot(a, id, 'partner');

    await switchTo(a, 'Together');
    await a.getByRole('link', { name: /Better Call Saul/ }).click();
    await expect(a.getByTestId('list-partner')).toContainText('Watching');
    await a.getByTestId('list-together').scrollIntoViewIfNeeded();
    await a.evaluate(() => document.querySelector('#lists-h')?.scrollIntoView());
    await shoot(a, id, 'title');

    await a.getByRole('link', { name: 'Back' }).click();
    await switchTo(a, 'Ana');
    await a.getByRole('button', { name: 'Add', exact: true }).click();
    const sheet = a.getByRole('dialog', { name: 'Add a title' });
    await expect(sheet.getByRole('radio', { name: 'Just me' })).toHaveAttribute('aria-checked', 'true');
    await shoot(a, id, 'add');
  });
}
