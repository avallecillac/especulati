import { expect, test } from './fixtures/catalog';
import { openApp } from './helpers.ts';

const KEY = 'TEST-KEY-abcd1234';
const AFTER_DARK = '9789871544059';

async function saveKey(page: import('@playwright/test').Page) {
  await openApp(page, '#/settings');
  await page.getByLabel('Google Books API key').fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('google-key-mask')).toHaveText('••••1234');
}

async function scan(page: import('@playwright/test').Page, fakeCamera: { show(v: string): Promise<void> }) {
  await fakeCamera.show(AFTER_DARK);
  await page.goto('/#/scan');
}

const googleReqs = (catalog: { requestLog(): { url: string; headers: Record<string, string> }[] }) =>
  catalog.requestLog().filter((r) => new URL(r.url).hostname === 'www.googleapis.com');

test('(a) saving a key and pressing Test key shows "Key works"', async ({ page }) => {
  await saveKey(page);
  await page.getByRole('button', { name: 'Test key' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Key works' })).toBeVisible();
});

test('(b) a keyed Google lookup finds the book and sends only the origin as referrer', async ({ page, fakeCamera, catalog }) => {
  await saveKey(page);
  await scan(page, fakeCamera);
  await expect(page.getByLabel('Title')).toHaveValue('After Dark', { timeout: 15_000 });
  await expect(page.getByLabel('Author')).toHaveValue('Haruki Murakami');

  const g = googleReqs(catalog).filter((r) => r.url.includes(`isbn:${AFTER_DARK}`));
  expect(g).toHaveLength(1);
  expect(g[0]!.url).toContain(`key=${KEY}`);
  const origin = new URL(page.url()).origin;
  expect(g[0]!.headers['referer']).toBe(`${origin}/`);
});

test('(c) after Remove, Google requests carry no key and no referer', async ({ page, fakeCamera, catalog }) => {
  await saveKey(page);
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('google-key-mask')).toHaveCount(0);

  await scan(page, fakeCamera);
  await expect(page.getByLabel('Title')).toHaveValue('After Dark', { timeout: 15_000 });
  const g = googleReqs(catalog).filter((r) => r.url.includes(`isbn:${AFTER_DARK}`));
  expect(g).toHaveLength(1);
  expect(g[0]!.url).not.toContain('key=');
  expect(g[0]!.headers['referer']).toBeUndefined();
});

test('(d) a rejected key shows a hint and the book saves as pending', async ({ page, fakeCamera, catalog }) => {
  await saveKey(page);
  catalog.fail('googleapis', 403);
  await scan(page, fakeCamera);
  await expect(page.getByText('Google Books key was rejected — check Settings.')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Title').fill('After Dark');
  await page.getByRole('button', { name: 'Save book' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Details pending')).toBeVisible();
});

test('(e) the key never appears in the page text, only masked', async ({ page }) => {
  await saveKey(page);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toContain(KEY);
  expect(text).toContain('••••1234');
  await page.getByRole('button', { name: 'Test key' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Key works' })).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(KEY);
});
