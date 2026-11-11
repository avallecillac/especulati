import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { normalizeQuote, passageUrl } from '../packages/lector-core/src/highlight.ts';
import { APP_ORIGIN, ARTICLE, expect, syncAndOpenArticles, test, turnOnSync } from './fixtures/extension.ts';

/**
 * Feature 007 US1 (T015): saving a highlight from the extension. The EXT_E2E build is driven through
 * its test hooks (the handlers behind the shortcut and the context menu), against the shared relay.
 */
const FIXTURES = fileURLToPath(new URL('../apps/lector-extension/test/fixtures/', import.meta.url));
const expected = JSON.parse(readFileSync(`${FIXTURES}expected.json`, 'utf8')) as { host: string; pages: Record<string, unknown> };
const names = Object.keys(expected.pages);

const rows = (page: Page) => page.getByTestId('article-row');
const toastOf = (page: Page) => page.locator('#lector-toast');
const entries = (page: Page) => page.getByRole('article', { name: /^(Highlight|Note)$/ });

/** Select the longest paragraph (or list item) (a real Range, as a drag would make) and return its text as the page renders it. */
async function selectParagraph(page: Page): Promise<{ selected: string; text: string }> {
  return page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('p, li'));
    const p = ps.reduce((a, b) => ((b.textContent ?? '').length > (a.textContent ?? '').length ? b : a));
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return { selected: sel.toString(), text: p.textContent ?? '' };
  });
}

const storedHighlights = (ext: { sw: import('@playwright/test').Worker }) =>
  ext.sw.evaluate(async () => {
    const got = await (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>> } } } }).chrome.storage.local.get('highlights');
    return Object.values((got['highlights'] ?? {}) as Record<string, { quote: string | null; note: string | null; removed?: boolean }>);
  });

async function openFirstArticle(pwa: Page): Promise<void> {
  await syncAndOpenArticles(pwa);
  await rows(pwa).first().getByRole('link').click();
}

test('the shortcut saves a highlight, Add note adds a note, and the PWA shows both after sync', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  const { selected } = await selectParagraph(page);
  await ext.highlight('command');
  const toast = toastOf(page);
  await expect(toast.getByText('Highlight saved')).toBeVisible();
  await toast.getByRole('button', { name: 'Add note' }).click();
  await toast.getByRole('textbox', { name: 'Note' }).fill('a note');
  await toast.getByRole('button', { name: 'Save' }).click();
  await expect(toast.getByText('Note saved')).toBeVisible();

  await ext.sent();
  await openFirstArticle(pwa);
  await expect(entries(pwa)).toHaveCount(1);
  await expect(entries(pwa).first()).toContainText('a note');
  const quote = normalizeQuote(selected);
  if (!quote.ok || quote.value === null) throw new Error('quote');
  await expect(entries(pwa).first()).toContainText(quote.value.split('\n')[0]!.slice(0, 60));
});

test('the context menu saves a highlight too; Enter saves the note and Esc cancels the box', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await selectParagraph(page);
  await ext.highlight('menu');
  const toast = toastOf(page);
  await expect(toast.getByText('Highlight saved')).toBeVisible();
  await toast.getByRole('button', { name: 'Add note' }).click();
  const box = toast.getByRole('textbox', { name: 'Note' });
  await box.fill('dropped');
  await box.press('Escape');
  await expect(box).toHaveCount(0);
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  await toast.getByRole('button', { name: 'Add note' }).click();
  await box.fill('kept');
  await box.press('Enter');
  await expect(toast.getByText('Note saved')).toBeVisible();

  await ext.sent();
  await openFirstArticle(pwa);
  await expect(entries(pwa).first()).toContainText('kept');
  await expect(entries(pwa).first()).not.toContainText('dropped');
});

test('the countdown is held while the note box is open', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await selectParagraph(page);
  await ext.highlight('command');
  const toast = toastOf(page);
  await toast.getByRole('button', { name: 'Add note' }).click();
  await page.waitForTimeout(6500);
  await expect(toast.getByRole('textbox', { name: 'Note' })).toBeVisible();
  await toast.getByRole('textbox', { name: 'Note' }).press('Escape');
  await expect(toast).toHaveCount(0, { timeout: 8000 });
});

test('Undo on a fresh page removes both the highlight and the article it created', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await selectParagraph(page);
  await ext.highlight('command');
  await toastOf(page).getByRole('button', { name: 'Undo' }).click();
  await expect(toastOf(page).getByText('Removed')).toBeVisible();
  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(pwa.getByText('No articles yet.')).toBeVisible();
});

test('Undo keeps an article that was already logged', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.capture('action');
  await expect(toastOf(page).getByText(ARTICLE.title)).toBeVisible();
  await selectParagraph(page);
  await ext.highlight('command');
  await toastOf(page).getByRole('button', { name: 'Undo' }).click();
  await expect(toastOf(page).getByText('Removed')).toBeVisible();
  await ext.sent();
  await openFirstArticle(pwa);
  await expect(pwa.getByRole('heading', { name: 'Highlights' })).toBeVisible();
  await expect(entries(pwa)).toHaveCount(0);
});

test('with no selection the toast asks for one and nothing is pending', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.highlight('command');
  await expect(toastOf(page).getByText('Select some text to highlight')).toBeVisible();
  expect(await ext.waiting()).toBe(0);
  // A selection inside a field is not a passage to keep either.
  await page.evaluate(() => {
    const t = document.createElement('textarea');
    t.value = 'typed text';
    document.body.append(t);
    t.focus();
    t.select();
  });
  await ext.highlight('menu');
  await expect(toastOf(page).getByText('Select some text to highlight')).toBeVisible();
  expect(await ext.waiting()).toBe(0);
});

test('a passage over 5,000 characters is refused, not truncated', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.textContent = 'word '.repeat(1100);
    document.body.append(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await ext.highlight('command');
  await expect(toastOf(page).getByText('That passage is too long (5,000 characters max)')).toBeVisible();
  expect(await ext.waiting()).toBe(0);
});

test('SC-001: the toast is visible within 1 s of the trigger, on a page not yet logged', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await selectParagraph(page);
  const t0 = Date.now();
  const trigger = ext.highlight('command');
  await expect(toastOf(page).getByText('Highlight saved')).toBeVisible({ timeout: 1000 });
  const ms = Date.now() - t0;
  await trigger;
  console.log(`SC-001: highlight toast after ${ms} ms`);
  expect(ms).toBeLessThan(1000);
});

test('FR-006: offline, a save stays pending and is visible in the PWA once the relay is back', async ({ ext, pwa, relay }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await selectParagraph(page);
  relay.failWith(503);
  await ext.highlight('command');
  await expect(toastOf(page).getByText('Highlight saved')).toBeVisible();
  // The article and the highlight, both waiting.
  expect(await ext.waiting()).toBe(2);
  await expect.poll(() => ext.badge()).toBe('2');

  relay.failWith(null);
  await ext.sw.evaluate(() => (globalThis as unknown as { lector: { flush(): Promise<void> } }).lector.flush());
  await ext.sent();
  await expect.poll(() => ext.badge()).toBe('');
  await openFirstArticle(pwa);
  await expect(entries(pwa)).toHaveCount(1);
});

test('SC-004: on 20 fixture pages the saved quote equals the selected paragraph, after normalising', async ({ ext, pwa }) => {
  test.setTimeout(240_000);
  expect(names).toHaveLength(20);
  await ext.pair(await turnOnSync(pwa));
  await ext.context.route(/\/fixture\/[^/]+\.html/, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(`${FIXTURES}${name}`, 'utf8') });
  });
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  const misses: string[] = [];
  let hits = 0;
  for (const [i, name] of names.entries()) {
    const url = `${APP_ORIGIN}/fixture/${name}`;
    const page = await ext.openArticle(url);
    const { selected, text } = await selectParagraph(page);
    await ext.highlight('command', url);
    await expect(toastOf(page).getByText('Highlight saved')).toBeVisible();
    const saved = await storedHighlights(ext);
    const want = normalizeQuote(selected);
    const quote = want.ok ? want.value : null;
    // chrome.storage does not keep key order, so look the quote up instead of taking the last entry.
    const found = saved.filter((h) => h.quote !== null && h.quote === quote);
    if (saved.length === i + 1 && found.length === 1 && quote !== null && collapse(quote) === collapse(text)) hits++;
    else misses.push(`${name}: ${saved.length} saved, ${found.length} equal to the selection, selected ${selected.length} chars, paragraph ${text.length}`);
    await page.close();
  }
  console.log(`SC-004: saved quote equals the selected paragraph on ${hits}/20 pages`);
  if (misses.length > 0) console.log(misses.join('\n'));
  expect(hits).toBe(20);
});

test('SC-005: passageUrl(url, quote) lands on the passage in at least 18 of 20 pages', async ({ page, context }) => {
  test.setTimeout(240_000);
  // Signal: the page paints ::target-text in magenta (a rule added to the served copy), and a screenshot
  // is searched for magenta pixels. Unlike scrollY, this also holds for passages already on screen, and
  // it is only produced when the browser itself found the quote through the text directive.
  const MAGENTA = '<style>::target-text { background: rgb(255, 0, 255) !important; color: rgb(0, 0, 0) !important; }</style>';
  const probe = await context.newPage();
  const magentaPixels = async (png: Buffer): Promise<number> => {
    await probe.goto('about:blank');
    return probe.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 240 && d[i + 1]! < 15 && d[i + 2]! > 240) n++;
      return n;
    }, png.toString('base64'));
  };

  const hits: string[] = [];
  const misses: string[] = [];
  for (const name of names) {
    const html = readFileSync(`${FIXTURES}${name}`, 'utf8').replace('</head>', `${MAGENTA}</head>`);
    const base = `http://${expected.host}/${name}`;
    await page.route(`http://${expected.host}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto(base);
    const { selected } = await selectParagraph(page);
    const quote = normalizeQuote(selected);
    if (!quote.ok) throw new Error('quote');
    expect(await magentaPixels(await page.screenshot())).toBe(0);
    await page.goto('about:blank');
    await page.goto(passageUrl(base, quote.value));
    await page.waitForTimeout(300);
    const n = await magentaPixels(await page.screenshot());
    (n > 100 ? hits : misses).push(name);
    await page.unroute(`http://${expected.host}/**`);
  }
  console.log(`SC-005: text fragment matched ${hits.length}/20; missed: ${misses.join(', ') || 'none'}`);
  expect(hits.length).toBeGreaterThanOrEqual(18);
});
