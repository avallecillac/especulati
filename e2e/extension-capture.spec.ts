import { ARTICLE, ARTICLE_URL, expect, syncAndOpenArticles, test, turnOnSync } from './fixtures/extension.ts';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const rows = (page: import('@playwright/test').Page) => page.getByTestId('article-row');


test('pairing: address plus the code from Show code reaches Paired', async ({ ext, pwa }) => {
  const code = await turnOnSync(pwa);
  const options = await ext.pair(code);
  await expect(options.getByText('Waiting to be sent: 0')).toBeVisible();
});

test('a wrong code does not pair', async ({ ext }) => {
  const options = await ext.context.newPage();
  await options.goto(`chrome-extension://${ext.id}/options.html`);
  await options.getByLabel('Lector address').fill('http://localhost:4173');
  await options.getByLabel('Sync code').fill('not a code');
  await options.getByRole('button', { name: 'Pair' }).click();
  await expect(options.getByText('That is not a sync code.')).toBeVisible();
});

test('toolbar capture: the toast shows the title and ~N min; the PWA lists it, dated today', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.capture('action');
  const toast = page.locator('#lector-toast');
  await expect(toast.getByText(ARTICLE.title)).toBeVisible();
  await expect(toast.getByText(new RegExp(`~${ARTICLE.minutes} min`))).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();

  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(rows(pwa)).toHaveCount(1);
  await expect(rows(pwa).first()).toContainText(ARTICLE.title);
  await expect(rows(pwa).first()).toContainText(today());
  await expect(rows(pwa).first()).toContainText(`~${ARTICLE.minutes} min`);
});

test('the keyboard command and the context menu capture too', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const a = await ext.openArticle(`${ARTICLE_URL}?via=command`);
  await ext.capture('command', `${ARTICLE_URL}?via=command`);
  await expect(a.locator('#lector-toast').getByText(ARTICLE.title)).toBeVisible();
  const b = await ext.openArticle(`${ARTICLE_URL}?via=menu`);
  await ext.capture('menu', `${ARTICLE_URL}?via=menu`);
  await expect(b.locator('#lector-toast').getByText(ARTICLE.title)).toBeVisible();

  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(rows(pwa)).toHaveCount(2);
});

test('duplicate: already logged; Cancel adds nothing; Log again adds a second', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.capture('action');
  await expect(page.locator('#lector-toast').getByText(ARTICLE.title)).toBeVisible();

  await ext.capture('action');
  const toast = page.locator('#lector-toast');
  await expect(toast.getByText(/Already logged on/)).toBeVisible();
  await toast.getByRole('button', { name: 'Cancel' }).click();
  await expect(toast).toHaveCount(0);
  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(rows(pwa)).toHaveCount(1);

  await ext.capture('action');
  await expect(toast.getByText(/Already logged on/)).toBeVisible();
  await toast.getByRole('button', { name: 'Log again' }).click();
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(rows(pwa)).toHaveCount(2);
});

test('undo removes the article in the PWA after sync', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  await ext.capture('action');
  await page.locator('#lector-toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#lector-toast').getByText('Removed')).toBeVisible();
  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(pwa.getByText('No articles yet.')).toBeVisible();
});

test('offline: the badge shows 1, and the capture is sent once the relay works', async ({ ext, pwa, relay }) => {
  await ext.pair(await turnOnSync(pwa));
  const page = await ext.openArticle();
  relay.failWith(503);
  await ext.capture('action');
  await expect(page.locator('#lector-toast').getByText(ARTICLE.title)).toBeVisible();
  expect(await ext.waiting()).toBe(1);
  await expect.poll(() => ext.badge()).toBe('1');

  relay.failWith(null);
  await ext.sw.evaluate(() => (globalThis as unknown as { lector: { flush(): Promise<void> } }).lector.flush());
  await ext.sent();
  await expect.poll(() => ext.badge()).toBe('');
  await ext.sent();
  await syncAndOpenArticles(pwa);
  await expect(rows(pwa)).toHaveCount(1);
});

test('the extension makes no pulls: it never reads /batches (FR-012)', async ({ ext, pwa }) => {
  await ext.pair(await turnOnSync(pwa));
  await ext.openArticle();
  // Requests made by the extension's service worker only (the PWA pulls on its own context).
  const seen: string[] = [];
  ext.context.on('request', (r) => {
    if (r.serviceWorker() !== null && r.url().includes('/api/')) seen.push(`${r.method()} ${new URL(r.url()).pathname.replace(/[0-9a-f]{32}/, ':space')}`);
  });
  await ext.capture('action');
  await expect.poll(() => ext.waiting()).toBe(0);
  expect(seen).toContain('POST /api/v1/spaces/:space/batches');
  expect(seen.filter((r) => r.startsWith('GET'))).toEqual([]);
});
