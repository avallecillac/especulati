import type { Page } from '@playwright/test';
import { ARTICLE, expect, syncAndOpenArticles, test, turnOnSync } from './fixtures/extension.ts';

/**
 * Feature 008 US1/US2 on the Mac (T021): Save for later from the extension. The EXT_E2E build is
 * driven through its test hooks (the handlers behind the shortcut and the context menu).
 */
const toastOf = (page: Page) => page.locator('#lector-toast');
const savedRows = (page: Page) => page.getByTestId('saved-row');
const articleRows = (page: Page) => page.getByTestId('article-row');

const storedTables = (ext: { sw: import('@playwright/test').Worker }) =>
  ext.sw.evaluate(async () => {
    const got = await (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>> } } } }).chrome.storage.local.get('pending');
    return ((got['pending'] ?? []) as { tbl: string; fields: Record<string, unknown> }[]).map((o) => `${o.tbl}:${typeof o.fields['name'] === 'string' ? o.fields['name'] : ''}`);
  });

async function openSaved(pwa: Page): Promise<void> {
  await pwa.goto('/#/');
  const button = pwa.getByRole('button', { name: 'Sync now' });
  await button.click();
  await expect(button).toBeEnabled();
  await pwa.goto('/#/library');
  await pwa.getByRole('tab', { name: 'Saved' }).click();
}

test('the shortcut saves the page; SC-001: the toast shows within 1 s; the PWA lists it under Saved', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  const t0 = Date.now();
  await ext.save('command');
  await expect(toastOf(page).getByText('Saved for later')).toBeVisible({ timeout: 1000 });
  console.log(`SC-001 toast after ${Date.now() - t0} ms`);
  expect(Date.now() - t0).toBeLessThan(1000);
  await expect(toastOf(page).getByRole('button', { name: 'Add tags' })).toBeVisible();
  await expect(toastOf(page).getByRole('button', { name: 'Undo' })).toBeVisible();
  await ext.sent();
  await openSaved(pwa);
  await expect(savedRows(pwa)).toHaveCount(1);
  await expect(savedRows(pwa).first()).toContainText(ARTICLE.title);
  await pwa.getByRole('tab', { name: 'Articles' }).click();
  await expect(articleRows(pwa)).toHaveCount(0);
});

test('the context menu saves the page too', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.save('menu');
  await expect(toastOf(page).getByText('Saved for later')).toBeVisible();
  await ext.sent();
  await openSaved(pwa);
  await expect(savedRows(pwa)).toHaveCount(1);
});

test('the menu on a link saves the URL alone, with the site as the title', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.save('link', { linkUrl: 'https://blog.example.org/some/essay' });
  await expect(toastOf(page).getByText('Saved for later')).toBeVisible();
  await ext.sent();
  await openSaved(pwa);
  await expect(savedRows(pwa)).toHaveCount(1);
  await expect(savedRows(pwa).first()).toContainText('blog.example.org');
  await expect(savedRows(pwa).first().getByRole('link')).toHaveAttribute('href', 'https://blog.example.org/some/essay');
});

test('Add tags "ai, design" adds both', async ({ ext, pwa, relay }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  relay.failWith(503); // keep the ops pending so the test can read them
  await ext.save('command');
  const toast = toastOf(page);
  await toast.getByRole('button', { name: 'Add tags' }).click();
  await toast.getByRole('textbox', { name: 'Tags' }).fill('ai, design');
  await toast.getByRole('button', { name: 'Save' }).click();
  await expect(toast.getByText('2 tags added')).toBeVisible();
  const ops = await storedTables(ext);
  expect(ops.filter((o) => o.startsWith('tags:')).sort()).toEqual(['tags:ai', 'tags:design']);
  expect(ops.filter((o) => o.startsWith('item_tags:'))).toHaveLength(2);
  relay.failWith(null);
  await ext.sw.evaluate(() => (globalThis as unknown as { lector: { flush(): Promise<void> } }).lector.flush());
  await ext.sent();
});

test('a tag name over 40 characters is dropped with a short message', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.save('command');
  const toast = toastOf(page);
  await toast.getByRole('button', { name: 'Add tags' }).click();
  await toast.getByRole('textbox', { name: 'Tags' }).fill(`ok, ${'x'.repeat(41)}`);
  await toast.getByRole('textbox', { name: 'Tags' }).press('Enter');
  await expect(toast.getByText('1 tag added, 1 skipped')).toBeVisible();
});

test('Undo removes the saved entry', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.save('command');
  await toastOf(page).getByRole('button', { name: 'Undo' }).click();
  await expect(toastOf(page).getByText('Removed')).toBeVisible();
  await ext.sent();
  await openSaved(pwa);
  await expect(savedRows(pwa)).toHaveCount(0);
});

test('Log as read on the same page marks the saved entry read: one article, and Add tags is offered', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.save('command');
  await ext.capture('action');
  const toast = toastOf(page);
  await expect(toast.getByText(/^Logged/)).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Add tags' })).toBeVisible();
  await toast.getByRole('button', { name: 'Add tags' }).click();
  await toast.getByRole('textbox', { name: 'Tags' }).fill('later');
  await toast.getByRole('button', { name: 'Save' }).click();
  await expect(toast.getByText('1 tag added')).toBeVisible();
  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(articleRows(pwa)).toHaveCount(1);
  await pwa.getByRole('tab', { name: 'Saved' }).click();
  await expect(savedRows(pwa)).toHaveCount(0);
});

test('the highlight shortcut on a saved page marks it read first, then adds the highlight', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.save('command');
  await page.evaluate(() => {
    const p = document.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await ext.highlight('command');
  await expect(toastOf(page).getByText('Highlight saved')).toBeVisible();
  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(articleRows(pwa)).toHaveCount(1);
  await articleRows(pwa).first().getByRole('link').click();
  await expect(pwa.getByRole('article', { name: /^(Highlight|Note)$/ })).toHaveCount(1);
});

test('offline, a save stays pending, then flushes', async ({ ext, pwa, relay }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  relay.failWith(503);
  await ext.save('command');
  await expect(toastOf(page).getByText('Saved for later')).toBeVisible();
  expect(await ext.waiting()).toBe(1);
  await expect.poll(() => ext.badge()).toBe('1');
  relay.failWith(null);
  await ext.sw.evaluate(() => (globalThis as unknown as { lector: { flush(): Promise<void> } }).lector.flush());
  await ext.sent();
  await openSaved(pwa);
  await expect(savedRows(pwa)).toHaveCount(1);
});
