import type { Page } from '@playwright/test';
import { currentCard, openApp } from './helpers';
import { expect, test } from './fixtures/catalog';

const HIT = 'The Left Hand of Darkness · Ursula K. Le Guin · 1969';

test('(9) search by title, pick a hit, save with its ISBN', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: 'Search by title' }).click();
  await expect(page).toHaveURL(/#\/search$/);
  await expect(page.getByRole('heading', { name: 'Search by title' })).toBeVisible();

  await page.getByLabel('Title').fill('left hand of darkness');
  await page.getByLabel('Title').press('Enter');
  const hit = page.getByRole('button', { name: HIT });
  await expect(hit).toBeVisible();

  await hit.click();
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByLabel('Title')).toHaveValue('The Left Hand of Darkness');
  await expect(page.getByLabel('Author')).toHaveValue('Ursula K. Le Guin');
  await expect(page.getByLabel('Total pages')).toHaveValue('304');
  await expect(page.getByText('ISBN 9780441478026')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Cover of The Left Hand of Darkness' })).toBeVisible();

  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await currentCard(page).getByRole('link', { name: 'The Left Hand of Darkness' }).click();
  await expect(page.getByText('ISBN 9780441478026')).toBeVisible();
  await expect(page.getByText('Details pending')).toBeHidden();
});

test('a hit whose ISBN is already in the library offers to open it or add a copy', async ({ page }) => {
  await page.goto('/#/search');
  await expect(page.getByTestId('ready')).toBeAttached();
  for (let i = 0; i < 2; i++) {
    await page.goto('/#/search');
    await page.getByLabel('Title').fill('left hand of darkness');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('button', { name: HIT }).click();
    if (i === 0) {
      await expect(page).toHaveURL(/#\/add$/);
      await page.getByRole('button', { name: 'Save book' }).click();
      await expect(page).toHaveURL(/#\/$/);
    }
  }
  const dialog = page.getByRole('alertdialog', { name: 'Already in your library' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Add another copy' }).click();
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByLabel('Title')).toHaveValue('The Left Hand of Darkness');
});

test('no results shows "No matches" and Add manually keeps the query as the title', async ({ page }) => {
  await page.goto('/#/search');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByLabel('Title').fill('zzzz qqqq');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No matches')).toBeVisible();
  await page.getByRole('button', { name: 'Add manually' }).click();
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByLabel('Title')).toHaveValue('zzzz qqqq');
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(currentCard(page).getByRole('link', { name: 'zzzz qqqq' })).toBeVisible();
});

test('offline shows the message and Add manually', async ({ page, context, catalog }) => {
  await page.goto('/#/search');
  await expect(page.getByTestId('ready')).toBeAttached();
  await context.setOffline(true);
  await page.getByLabel('Title').fill('left hand of darkness');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText("Couldn't search — you're offline or the catalogs are unavailable.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add manually' })).toBeVisible();
  expect(catalog.requests().filter((u) => u.includes('search.json'))).toHaveLength(0);
});

test('a query under 3 characters is not sent', async ({ page, catalog }) => {
  await page.goto('/#/search');
  await expect(page.getByTestId('ready')).toBeAttached();
  await page.getByLabel('Title').fill('ab');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Type at least 3 characters.')).toBeVisible();
  expect(catalog.requests()).toHaveLength(0);
});

// Feature 008 US4: Library search over articles, with an AND tag filter (contracts/ui-008.md).

const articleLink = (o: { slug: string; title: string; host?: string; later?: boolean; quote?: string }): string => {
  const json = JSON.stringify({
    v: 1,
    url: `https://${o.host ?? 'www.example.com'}/read/${o.slug}`,
    title: o.title,
    author: 'Ann Author',
    words: 2380,
    at: new Date().toISOString(),
    ...(o.later ? { later: 1 } : {}),
    ...(o.quote ? { quote: o.quote } : {}),
  });
  return `/#/capture?d=${encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'))}`;
};

/** Seed one article through a capture link. */
async function capture(page: Page, o: Parameters<typeof articleLink>[0]): Promise<void> {
  await page.goto(articleLink(o));
  await expect(page.getByText(o.later ? 'Saved for later' : o.quote ? 'Highlight saved' : /^Logged: /)).toBeVisible();
}

/** Tag an article from its screen: open it from the Articles list (read) or the Saved list's Details (saved). */
async function tagArticle(page: Page, title: string, tags: string[], saved = false): Promise<void> {
  await page.goto('/#/library');
  if (saved) {
    await page.getByRole('tab', { name: 'Saved' }).click();
    await page.getByTestId('saved-row').filter({ hasText: title }).getByRole('button', { name: 'More' }).click();
    await page.getByRole('link', { name: 'Details' }).click();
  } else {
    await page.getByRole('tab', { name: 'Articles' }).click();
    await page.getByTestId('article-row').filter({ hasText: title }).getByRole('link').first().click();
  }
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  for (const t of tags) {
    const input = page.getByRole('combobox', { name: 'Add tag', exact: true });
    await input.fill(t);
    await input.press('Enter');
    await expect(page.getByRole('button', { name: `Remove tag ${t}`, exact: true })).toBeVisible();
  }
}

const box = (page: Page) => page.getByRole('searchbox', { name: 'Search articles' });
const hits = (page: Page) => page.getByTestId('search-row');
const chipBtn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Articles' }).click();
}

async function seedSearch(page: Page): Promise<void> {
  await openApp(page);
  await capture(page, { slug: 'garden', title: 'Gardening Handbook' });
  await capture(page, { slug: 'morning', title: 'Quiet Mornings', host: 'blog.example.org', later: true });
  await capture(page, { slug: 'cafe', title: 'Café Society' });
  await capture(page, { slug: 'habit', title: 'Habits Of Mind', quote: 'The invisible tapestry of habit shapes every day.' });
  await tagArticle(page, 'Gardening Handbook', ['ai', 'ml']);
  await tagArticle(page, 'Quiet Mornings', ['ai'], true);
  await tagArticle(page, 'Café Society', ['ml']);
  await tagArticle(page, 'Habits Of Mind', ['ai', 'ml']);
}

test('finds articles by title word, site, tag and highlight phrase, with Read and Saved labels', async ({ page }) => {
  await seedSearch(page);
  await openLibrary(page);

  await box(page).fill('gardening');
  await expect(hits(page)).toHaveCount(1);
  await expect(hits(page).first()).toContainText('Gardening Handbook');
  await expect(hits(page).first().getByText('Read', { exact: true })).toBeVisible();
  await expect(hits(page).first().getByRole('link', { name: 'Gardening Handbook' })).toHaveAttribute('href', /#\/article\//);

  await box(page).fill('blog.example');
  await expect(hits(page)).toHaveCount(1);
  await expect(hits(page).first()).toContainText('Quiet Mornings');
  await expect(hits(page).first().getByText('Saved', { exact: true })).toBeVisible();

  await box(page).fill('ml');
  await expect(hits(page)).toHaveCount(3);

  await box(page).fill('tapestry');
  await expect(hits(page)).toHaveCount(1);
  await expect(hits(page).first()).toContainText('Habits Of Mind');
  await expect(hits(page).first().locator('mark')).toHaveText('tapestry');
});

test('"cafe" finds "Café", and a passage match marks accented text', async ({ page }) => {
  await seedSearch(page);
  await capture(page, { slug: 'dish', title: 'Dish Notes', quote: 'We met at the Café on the corner.' });
  await openLibrary(page);
  await box(page).fill('cafe');
  await expect(hits(page)).toHaveCount(2);
  await expect(hits(page).filter({ hasText: 'Café Society' })).toHaveCount(1);
  await expect(hits(page).locator('mark')).toHaveText(['Café']);
});

test('two selected chips filter with AND, combine with text, and Clear resets both', async ({ page }) => {
  await seedSearch(page);
  await openLibrary(page);
  await expect(chipBtn(page, 'ai')).toHaveAttribute('aria-pressed', 'false');

  await chipBtn(page, 'ai').click();
  await expect(chipBtn(page, 'ai')).toHaveAttribute('aria-pressed', 'true');
  await expect(hits(page)).toHaveCount(3);
  await chipBtn(page, 'ml').click();
  await expect(hits(page)).toHaveCount(2); // AND: ai and ml
  await expect(hits(page).filter({ hasText: 'Quiet Mornings' })).toHaveCount(0);

  await box(page).fill('tapestry');
  await expect(hits(page)).toHaveCount(1);
  await expect(hits(page).first()).toContainText('Habits Of Mind');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(box(page)).toHaveValue('');
  await expect(chipBtn(page, 'ai')).toHaveAttribute('aria-pressed', 'false');
  await expect(chipBtn(page, 'ml')).toHaveAttribute('aria-pressed', 'false');
  await expect(hits(page)).toHaveCount(0);
  await expect(page.getByTestId('article-row')).toHaveCount(3); // the normal Articles list is back
});

test('"No results" offers Clear; "All tags…" opens the tags sheet next to the chips', async ({ page }) => {
  await seedSearch(page);
  await openLibrary(page);
  await box(page).fill('zzzz');
  await expect(page.getByText('No results')).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(box(page)).toHaveValue('');
  await expect(page.getByText('No results')).toHaveCount(0);

  await page.getByRole('button', { name: 'All tags…' }).click();
  await expect(page.getByRole('dialog', { name: 'All tags' })).toBeVisible();
});

test('SC-004: with 500 articles, results appear within 200 ms of the last keystroke (best of 3)', async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  // Seed through capture links, driven inside the page so each takes a few ms rather than a navigation.
  await page.evaluate(async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 500; i++) {
      const json = JSON.stringify({
        v: 1,
        url: `https://www.example.com/read/n${i}`,
        title: `Essay q${String(i).padStart(4, '0')}`,
        author: 'Ann Author',
        words: 2380,
        at: new Date().toISOString(),
      });
      location.hash = '#/library';
      await wait(0);
      location.hash = `#/capture?d=${encodeURIComponent(btoa(json))}`;
      const done = `Logged: Essay q${String(i).padStart(4, '0')}`;
      for (let t = 0; t < 600 && !document.body.innerText.includes(done); t++) await wait(5);
    }
  });
  await openLibrary(page);
  await page.getByTestId('article-row').first().waitFor();

  const times: number[] = [];
  for (const q of ['q0042', 'q0317', 'q0499']) {
    const ms = await page.evaluate(async (query) => {
      const input = document.querySelector<HTMLInputElement>('input[type="search"][aria-label="Search articles"]')!;
      const t0 = performance.now();
      const done = new Promise<number>((resolve) => {
        const check = () => {
          const rows = document.querySelectorAll('[data-testid="search-row"]');
          if (rows.length === 1 && rows[0]!.textContent.includes(query)) resolve(performance.now() - t0);
          else requestAnimationFrame(check);
        };
        check();
      });
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return done;
    }, q);
    times.push(ms);
    await box(page).fill('');
    await expect(hits(page)).toHaveCount(0);
  }
  console.log(`search latency ms: ${times.map((t) => t.toFixed(0)).join(', ')}`);
  expect(Math.min(...times)).toBeLessThan(200);
});
