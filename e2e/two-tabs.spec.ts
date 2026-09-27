import { expect, test, type Page } from '@playwright/test';
import { addBook, currentCard, openApp } from './helpers.ts';

/** Headless pages are all "visible"; emulate switching tabs with the same signal the app uses. */
async function setVisible(page: Page, visible: boolean): Promise<void> {
  await page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { value: v ? 'visible' : 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

test('two tabs take turns on the DB; a write in one shows in the other when it is focused again', async ({ context }) => {
  const a = await context.newPage();
  await openApp(a);
  await addBook(a, { title: 'From tab A', pages: 100 });

  // A goes to the background: its worker closes the DB and releases the Web Lock.
  await setVisible(a, false);
  const b = await context.newPage();
  await openApp(b);
  await expect(currentCard(b).getByRole('heading', { name: 'From tab A' })).toBeVisible();
  await addBook(b, { title: 'From tab B', pages: 100 });

  // Back to A: it reacquires the DB and refreshes to show B's write.
  await setVisible(b, false);
  await setVisible(a, true);
  await expect(currentCard(a).getByRole('heading', { name: 'From tab B' })).toBeVisible();
});

test('a second visible window reports that Readerlog is open elsewhere, then recovers', async ({ context }) => {
  const a = await context.newPage();
  await openApp(a);
  const b = await context.newPage();
  await b.goto('/#/');
  await expect(b.getByRole('alert')).toHaveText(/Readerlog is open in another window/, { timeout: 10_000 });

  // The other window goes to the background; bringing this one forward reconnects it.
  await setVisible(a, false);
  await setVisible(b, true);
  await expect(b.getByRole('alert')).toHaveCount(0);
  await expect(b.getByText('No book in progress')).toBeVisible();
});
