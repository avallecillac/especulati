import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addBook, currentCard, openApp, openLogSheet } from './helpers.ts';

// Same instant, two zones: 2026-06-01 22:00 in New York is 2026-06-02 11:00 in Tokyo.
const INSTANT = new Date('2026-06-02T02:00:00Z');

test('time zone change while travelling: old entries keep their dates, new ones use the new zone', async ({ baseURL }) => {
  const profile = mkdtempSync(join(tmpdir(), 'readerlog-tz-'));
  const executablePath = process.env['PLAYWRIGHT_BROWSERS_PATH'] ? '/opt/pw-browsers/chromium' : undefined;
  const open = (timezoneId: string): Promise<BrowserContext> =>
    chromium.launchPersistentContext(profile, { baseURL: baseURL!, timezoneId, locale: 'en-US', reducedMotion: 'reduce', ...(executablePath ? { executablePath } : {}) });

  try {
    const ny = await open('America/New_York');
    const p1 = ny.pages()[0] ?? (await ny.newPage());
    await p1.clock.install({ time: INSTANT });
    await openApp(p1);
    await addBook(p1, { title: 'Travel book', pages: 300, start: false });
    await p1.goto('/#/library');
    await p1.getByRole('link', { name: 'Travel book' }).click();
    await p1.getByRole('button', { name: 'Log' }).click();
    const s1 = p1.getByRole('dialog', { name: 'Log progress' });
    await s1.getByLabel('Page', { exact: true }).fill('10');
    await s1.getByRole('button', { name: 'Save' }).click();
    const history1 = p1.getByRole('list', { name: 'History' });
    await expect(history1.getByRole('listitem')).toHaveCount(1);
    await expect(history1.locator('time')).toHaveAttribute('datetime', '2026-06-01');
    await ny.close();

    const tokyo = await open('Asia/Tokyo');
    const p2 = tokyo.pages()[0] ?? (await tokyo.newPage());
    await p2.clock.install({ time: INSTANT });
    await openApp(p2);
    const sheet = await openLogSheet(p2);
    await sheet.getByLabel('Page', { exact: true }).fill('25');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(currentCard(p2).getByText('p. 25 / 300')).toBeVisible();
    await currentCard(p2).getByRole('link', { name: 'Travel book' }).click();
    const times = p2.getByRole('list', { name: 'History' }).locator('time');
    await expect(times).toHaveCount(2); // the history loads after navigation
    const dates = await times.evaluateAll((els) => els.map((e) => e.getAttribute('datetime')));
    expect(dates).toEqual(['2026-06-02', '2026-06-01']);
    await tokyo.close();
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});
