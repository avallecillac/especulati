import { expect, test } from './fixtures/catalog';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const get = (page: import('@playwright/test').Page, url: string) =>
  page.evaluate(async (u) => {
    try {
      const r = await fetch(u);
      return { status: r.status, text: await r.text() };
    } catch (e) {
      return { error: String(e) };
    }
  }, url);

test('guard records and aborts a request no rule matches', async ({ page, catalog }) => {
  const res = await get(page, 'https://openlibrary.org/authors/OL1A.json');
  expect(res).toHaveProperty('error');
  expect(catalog.unmatched()).toEqual(['https://openlibrary.org/authors/OL1A.json']);
  catalog.allowUnmatchedForSelfTest(); // otherwise the guard would fail this test
});

test('routed ISBN search serves the Dune fixture; misses and failures work', async ({ page, catalog }) => {
  const url = 'https://openlibrary.org/search.json?isbn=9780441172719&limit=1';
  const hit = await get(page, url);
  expect(hit).toMatchObject({ status: 200 });
  expect(JSON.stringify(hit)).toContain('Dune');

  catalog.miss('9780441172719');
  expect(JSON.stringify(await get(page, url))).not.toContain('Dune');
  expect(await get(page, 'https://openlibrary.org/isbn/9780441172719.json')).toMatchObject({ status: 404 });
  expect(await get(page, 'https://www.googleapis.com/books/v1/volumes?q=isbn:9780441172719')).toMatchObject({
    status: 200,
    text: '{"totalItems":0}',
  });

  catalog.fail('googleapis', 429);
  expect(await get(page, 'https://www.googleapis.com/books/v1/volumes?q=isbn:1')).toMatchObject({ status: 429 });

  const cover = await page.evaluate(async () => (await (await fetch('https://covers.openlibrary.org/b/id/1-L.jpg')).blob()).size);
  expect(cover).toBeGreaterThan(1024);
  expect(catalog.requests()).toHaveLength(6);
  expect(catalog.unmatched()).toEqual([]);
});

test('fake camera yields one live video track and counts stop()', async ({ page, fakeCamera }) => {
  await fakeCamera.show('9780441172719');
  await page.goto('/'); // init script applies to navigations after the fixture is set up
  const kinds = await page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    (window as unknown as { s: MediaStream }).s = s;
    return s.getVideoTracks().map((t) => t.readyState);
  });
  expect(kinds).toEqual(['live']);
  expect(fakeCamera.liveTracks()).toBe(1);
  expect(fakeCamera.stoppedTracks()).toBe(0);
  await page.evaluate(() => (window as unknown as { s: MediaStream }).s.getTracks().forEach((t) => t.stop()));
  await expect.poll(() => fakeCamera.stoppedTracks()).toBe(1);
  expect(fakeCamera.liveTracks()).toBe(0);
});

test('fake camera deny() rejects with NotAllowedError', async ({ page, fakeCamera }) => {
  fakeCamera.deny();
  await page.goto('/');
  const name = await page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'ok', (e: DOMException) => e.name));
  expect(name).toBe('NotAllowedError');
});
