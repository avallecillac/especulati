import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { openApp } from './helpers.ts';

/** Log an article on `day` (the fixed clock decides `read_on`), the way the Shortcut does: a capture link. */
async function captureOn(page: Page, day: string, o: { url: string; words: number }): Promise<void> {
  await page.clock.setFixedTime(new Date(`${day}T17:00:00Z`));
  const json = JSON.stringify({ v: 1, url: o.url, title: `Read on ${day}`, words: o.words, at: `${day}T17:00:00Z` });
  await page.goto(`/#/capture?d=${encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'))}`);
  await expect(page.getByText(/^Logged: /)).toBeVisible();
}

test('the Articles section shows this week, this month, per-month counts, time and top sites', async ({ page }) => {
  await openApp(page);
  // "Today" is Wednesday 2026-06-17, so the week began on Monday the 15th.
  await captureOn(page, '2026-03-10', { url: 'https://example.com/a', words: 1190 });
  await captureOn(page, '2026-06-02', { url: 'https://example.com/b', words: 14280 });
  await captureOn(page, '2026-06-15', { url: 'https://blog.example.org/c', words: 0 });
  await captureOn(page, '2026-06-17', { url: 'https://www.example.com/d', words: 2380 });
  await captureOn(page, '2026-06-17', { url: 'https://example.com/e', words: 1190 });
  await captureOn(page, '2025-12-31', { url: 'https://other.example.net/old', words: 9999 });

  await page.clock.setFixedTime(new Date('2026-06-17T17:00:00Z'));
  await page.goto('/#/stats');
  const section = page.getByRole('region', { name: 'Articles' });
  await expect(section).toBeVisible();
  await expect(section.getByTestId('articles-week')).toHaveText('3');
  await expect(section.getByTestId('articles-month')).toHaveText('4');
  // (2380 + 1190 + 14280 + 1190) / 238 = 80 min; the 2025 article and the null word count are ignored.
  await expect(section.getByTestId('articles-time')).toHaveText('1 h 20 min');
  await expect(section.getByTestId('articles-month-3')).toHaveText('1');
  await expect(section.getByTestId('articles-month-6')).toHaveText('4');
  await expect(section.getByTestId('articles-month-12')).toHaveText('0');
  const sites = section.getByRole('list', { name: 'Top sites' }).getByRole('listitem');
  await expect(sites).toHaveText(['example.com (4)', 'blog.example.org (1)']);

  // Articles never touch the book stats.
  await expect(page.getByRole('heading', { name: /^0 reading days in 2026$/ })).toBeVisible();
  await expect(page.getByText('Log reading from a book to see stats here.')).toBeVisible();
});

test('with no articles the section shows zeros', async ({ page }) => {
  await openApp(page, '#/stats');
  const section = page.getByRole('region', { name: 'Articles' });
  await expect(section.getByTestId('articles-week')).toHaveText('0');
  await expect(section.getByTestId('articles-time')).toHaveText('0 h 0 min');
  await expect(section.getByRole('list', { name: 'Top sites' })).toHaveCount(0);
});
