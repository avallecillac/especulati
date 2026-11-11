import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * SC-003: the injected extractor on 20 synthetic pages (English and Spanish). Titles must be exact
 * for all 20 and the word count within 15% for at least 18. Pages are served by page.route on a
 * fake host, so nothing touches the network.
 */
const FIXTURES = fileURLToPath(new URL('../apps/lector-extension/test/fixtures/', import.meta.url));
const EXTRACT_JS = fileURLToPath(new URL('../apps/lector-extension/dist-e2e/extract.js', import.meta.url));

interface Expected {
  title: string;
  author: string | null;
  words: number | null;
}
const spec = JSON.parse(readFileSync(`${FIXTURES}expected.json`, 'utf8')) as { host: string; pages: Record<string, Expected> };

const wordsOk = (actual: number | null, expected: number | null): boolean =>
  expected === null ? actual === null : actual !== null && Math.abs(actual - expected) <= 0.15 * expected;

test('extractor: exact titles for 20 pages, words within 15% for at least 18 (SC-003)', async ({ page }) => {
  test.setTimeout(120_000);
  const names = Object.keys(spec.pages);
  expect(names).toHaveLength(20);

  const misses: string[] = [];
  let titleHits = 0;
  let authorHits = 0;
  let wordHits = 0;
  for (const name of names) {
    const want = spec.pages[name]!;
    const html = readFileSync(`${FIXTURES}${name}`, 'utf8');
    await page.route(`http://${spec.host}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto(`http://${spec.host}/${name}`);
    await page.addScriptTag({ path: EXTRACT_JS });
    const got = await page.evaluate(() => (globalThis as unknown as { __lectorExtract: () => Record<string, unknown> }).__lectorExtract());
    await page.unroute(`http://${spec.host}/**`);

    expect(Object.keys(got).sort()).toEqual(['author', 'title', 'url', 'words']);
    expect(got['url']).toBe(`http://${spec.host}/${name}`);
    if (got['title'] === want.title) titleHits++;
    else misses.push(`${name}: title ${JSON.stringify(got['title'])} != ${JSON.stringify(want.title)}`);
    if (got['author'] === want.author) authorHits++;
    else misses.push(`${name}: author ${JSON.stringify(got['author'])} != ${JSON.stringify(want.author)}`);
    if (wordsOk(got['words'] as number | null, want.words)) wordHits++;
    else misses.push(`${name}: words ${String(got['words'])} vs ${String(want.words)}`);
  }
  console.log(`extractor accuracy: titles ${titleHits}/20, authors ${authorHits}/20, words ${wordHits}/20`);
  if (misses.length > 0) console.log(misses.join('\n'));
  expect(titleHits).toBe(20);
  expect(authorHits).toBe(20);
  expect(wordHits).toBeGreaterThanOrEqual(18);
});
