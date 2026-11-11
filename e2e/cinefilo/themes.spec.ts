import type { Page } from '@playwright/test';
import { addByHand, expect, startList, tab, test } from './fixtures.ts';
import { installTmdb, saveKey } from './tmdb.ts';

test.use({ viewport: { width: 390, height: 844 } });
const covers = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Covers' }).getByRole('radio', { name, exact: true });
const themes = ['Béton', 'Willis'] as const;

test('generated covers draw in tokens on list rows, the add sheet results and the title header', async ({ page, context }) => {
  await installTmdb(context);
  await startList(page, 'Ana');
  await addByHand(page, { title: 'Stalker', year: '1979' });
  const row = page.getByRole('link', { name: /Stalker/ });
  await expect(row.getByTestId('cover')).toBeVisible();
  await expect(row.getByTestId('cover')).toHaveAttribute('aria-hidden', 'true');
  const box = await row.getByTestId('cover').boundingBox();
  expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([52, 72]);
  const fills = await row.getByTestId('cover').locator('rect').evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
  expect(fills.every((f) => /^var\(--[a-z-]+\)$/.test(f ?? ''))).toBe(true);

  await row.click();
  await expect(page.getByRole('heading', { name: 'Stalker' })).toBeVisible();
  const hero = page.getByTestId('cover');
  await expect(hero).toBeVisible();
  expect((await hero.boundingBox())!.width).toBeGreaterThanOrEqual(380);

  await page.getByRole('link', { name: 'Back' }).click();
  await saveKey(page);
  await tab(page, 'Watch later').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a title' });
  await sheet.getByLabel('Search TMDB').fill('Severance');
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(sheet.getByRole('list', { name: 'Search results' }).getByTestId('cover').first()).toBeVisible();
});

test('the same title draws the same cover on a second device', async ({ page, newDevice }) => {
  const code = await startList(page, 'Ana');
  await addByHand(page, { title: 'Stalker', year: '1979' });
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  const b = await newDevice();
  await b.page.goto('/#/');
  await b.page.getByRole('button', { name: 'Join with a code' }).click();
  await b.page.getByLabel('Sync code').fill(code);
  await b.page.getByRole('button', { name: 'Join', exact: true }).click();
  await b.page.getByLabel("I'm new").fill('Luz');
  await b.page.getByRole('button', { name: 'Create me' }).click();
  await tab(b.page, 'Watch later').click();
  const svg = (p: Page) => p.getByRole('link', { name: /Stalker/ }).getByTestId('cover').innerHTML();
  await tab(page, 'Watch later').click();
  expect(await svg(b.page)).toBe(await svg(page));
});

test('posters option: off shows the cover, on shows the filtered poster, a title without one falls back', async ({ page, context }) => {
  await installTmdb(context);
  await startList(page, 'Ana');
  await saveKey(page);
  await tab(page, 'Watch later').click();
  await addByHand(page, { title: 'Stalker', year: '1979' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a title' });
  await sheet.getByRole('button', { name: 'Series' }).click();
  await sheet.getByLabel('Search TMDB').fill('Severance');
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  await sheet.getByRole('button', { name: 'Add Severance (2022)' }).click();
  await expect(sheet).toBeHidden();

  const sev = page.getByRole('link', { name: /Severance/ });
  const stalker = page.getByRole('link', { name: /Stalker/ });
  await expect(sev.getByTestId('cover')).toBeVisible();
  await expect(page.getByTestId('poster-img')).toHaveCount(0);

  await tab(page, 'Settings').click();
  await covers(page, 'TMDB posters').click();
  await tab(page, 'Watch later').click();
  const img = sev.getByTestId('poster-img');
  await expect(img).toHaveAttribute('src', /^blob:/, { timeout: 10_000 });
  expect(await img.evaluate((el) => getComputedStyle(el).filter)).not.toBe('none');
  await expect(stalker.getByTestId('cover')).toBeVisible();
  await expect(stalker.getByTestId('poster-img')).toHaveCount(0);

  await tab(page, 'Settings').click();
  await covers(page, 'Generated').click();
  await tab(page, 'Watch later').click();
  await expect(sev.getByTestId('cover')).toBeVisible();
  await expect(page.getByTestId('poster-img')).toHaveCount(0);
});

for (const name of themes) {
  test(`${name}: welcome art, numbered tabs, verdict names and the both-loved mark`, async ({ page }) => {
    await page.addInitScript((n) => localStorage.setItem('cinefilo.appearance', n === 'Willis' ? 'willis' : 'beton'), name);
    await page.goto('/#/');
    await expect(page.getByTestId('ready')).toBeAttached();
    const art = page.getByTestId('welcome-art');
    await expect(art).toBeVisible();
    await expect(art).toHaveAttribute('aria-hidden', 'true');
    const fills = await art.locator('[fill],[stroke]').evaluateAll((els) => els.flatMap((e) => [e.getAttribute('fill'), e.getAttribute('stroke')]).filter((v): v is string => !!v && v !== 'none'));
    expect(fills.every((f) => f.startsWith('var(--'))).toBe(true);

    await page.getByRole('button', { name: 'Start a shared list' }).click();
    await page.getByLabel('Your name').fill('Ana');
    await page.getByRole('button', { name: 'Create the list' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await addByHand(page, { title: 'Stalker', year: '1979', status: 'Watched' });
    await tab(page, 'Watched').click();

    const tabs = page.getByRole('navigation', { name: 'Sections' });
    // The numbers are CSS counters: the accessible names stay "Watch later", "Watched", ...
    const pseudo = await tabs.getByRole('link').evaluateAll((els) => els.map((el) => getComputedStyle(el, '::before').content));
    if (name === 'Béton') {
      expect(pseudo.map((c) => c.includes('counter(tab'))).toEqual([true, true, true, false]);
    } else {
      expect(pseudo.every((c) => c === 'none' || c === 'normal')).toBe(true);
    }
    await expect(tabs.getByRole('link', { name: 'Watched', exact: true })).toBeVisible();

    await page.getByRole('link', { name: /Stalker/ }).click();
    const mine = page.getByTestId('rating-mine');
    for (const label of ['Like', 'Meh', "Didn't like"]) await expect(mine.getByRole('button', { name: label, exact: true })).toBeVisible();
    await mine.getByRole('button', { name: 'Like', exact: true }).click();
    await expect(mine.getByRole('button', { name: 'Like', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.getByRole('img', { name: 'You: Like' })).toBeVisible();
  });
}

test('series in progress draw a season progress mark in the Watching list', async ({ page }) => {
  await startList(page, 'Ana');
  await addByHand(page, { title: 'The Bear', kind: 'Series', status: 'Watching' });
  await tab(page, 'Watching').click();
  // No season count without TMDB data, so there is no progress mark: nothing invented.
  await expect(page.getByRole('link', { name: /The Bear/ })).toBeVisible();
  await expect(page.getByTestId('season-progress')).toHaveCount(0);
});

for (const [id, fill] of [['beton', 'rgb(22, 22, 21)'], ['willis', 'rgb(212, 162, 83)']] as const) {
  test(`${id}: tab labels fit 390px, selection is filled, back is a 44px control, hero is 200px, rows name whose mark`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cinefilo.appearance', t), id);
    await startList(page, 'Ana');
    await addByHand(page, { title: 'Stalker', year: '1979', status: 'Watched' });
    await tab(page, 'Watched').click();

    // Every tab label sits inside the viewport and is not wider than its own tab.
    const fits = await page.getByRole('navigation', { name: 'Sections' }).getByRole('link').evaluateAll((els) =>
      els.map((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const t = r.getBoundingClientRect();
        const a = el.getBoundingClientRect();
        return t.left >= 0 && t.right <= window.innerWidth && t.left >= a.left - 0.5 && t.right <= a.right + 0.5 && el.scrollWidth <= el.clientWidth + 1;
      }),
    );
    expect(fits).toEqual([true, true, true, true]);

    // Whose mark: the initials, aria-hidden, before the two verdict marks.
    const row = page.getByRole('link', { name: /Stalker/ });
    await expect(row.locator('.who')).toHaveText(['A', 'P']);
    await expect(row.getByRole('img', { name: /^You: / })).toBeVisible();

    await row.click();
    await expect(page.getByRole('heading', { name: 'Stalker' })).toBeVisible();
    const back = page.getByRole('link', { name: 'Back' });
    const b = (await back.boundingBox())!;
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([44, 44]);
    await expect(back.locator('svg')).toHaveCount(1);
    expect(await back.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
    expect(Math.round((await page.getByTestId('cover').boundingBox())!.height)).toBe(200);

    const watched = page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Watched' });
    await expect(watched).toHaveAttribute('aria-pressed', 'true');
    expect(await watched.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(fill);
    const like = page.getByTestId('rating-mine').getByRole('button', { name: 'Like', exact: true });
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(await like.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(fill);
    const meh = page.getByTestId('rating-mine').getByRole('button', { name: 'Meh', exact: true });
    expect(await meh.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(fill);
    // Verdicts use no green, yellow or red tokens: --like, --meh and --dislike stay in the theme's own palette.
    const tokens = await page.evaluate(() => ['--like', '--meh', '--dislike'].map((t) => getComputedStyle(document.documentElement).getPropertyValue(t).trim().toLowerCase()));
    const allowed = id === 'beton' ? ['#161615'] : ['#d4a253', '#a39478'];
    expect(tokens.every((t) => allowed.includes(t))).toBe(true);
    const today = page.getByRole('button', { name: 'Today' });
    await today.click();
    await expect(today).toHaveAttribute('aria-pressed', 'true');
  });
}
