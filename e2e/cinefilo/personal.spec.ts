import type { Page } from '@playwright/test';
import { addByHand, expect, openApp, startList, tab, test } from './fixtures.ts';
import { importCatalogue } from './seed.ts';

// personal-lists group 3: the list switch, the title screen "Lists" block, recommendations, "Add to".

async function join(page: Page, code: string, name: string) {
  await openApp(page);
  await page.getByRole('button', { name: 'Join with a code' }).click();
  await page.getByLabel('Sync code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.getByLabel("I'm new").fill(name);
  await page.getByRole('button', { name: 'Create me' }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
}

async function syncNow(page: Page) {
  await tab(page, 'Settings').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
}

const switchTo = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'List' }).getByRole('radio', { name, exact: true }).click();
const row = (page: Page, name: RegExp) => page.getByRole('link', { name });
const you = (page: Page) => page.getByTestId('list-you');

test('the switch opens on Together, names whose list is on screen, and the partner list is view-only', async ({ page }) => {
  await startList(page, 'Ana');
  await importCatalogue(page);
  await tab(page, 'Watch later').click();

  const group = page.getByRole('radiogroup', { name: 'List' });
  await expect(group.getByRole('radio')).toHaveText(['Together', 'Ana', 'Luz']);
  await expect(group.getByRole('radio', { name: 'Together' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('whose')).toHaveText('Together');
  await expect(row(page, /Inception/)).toBeVisible();

  await switchTo(page, 'Ana');
  await expect(page.getByTestId('whose')).toHaveText('Your list');
  await expect(row(page, /Inception/)).toHaveCount(0);

  await switchTo(page, 'Luz');
  await expect(page.getByTestId('whose')).toHaveText("Luz's list · view only");
  await expect(page.locator('.list-frame')).toHaveAttribute('data-scope', 'partner');
  await expect(page.locator('.rows button')).toHaveCount(0);

  // Opening the app again starts on Together (in-memory state only).
  await page.reload();
  await expect(page.getByTestId('ready')).toBeAttached();
  await expect(page.getByRole('radiogroup', { name: 'List' }).getByRole('radio', { name: 'Together' })).toHaveAttribute('aria-checked', 'true');
});

test('title screen: three rows, my status, season and date; Together stays as it was', async ({ page }) => {
  await startList(page, 'Ana');
  await importCatalogue(page);
  await tab(page, 'Watch later').click();
  await row(page, /Inception/).click();

  await expect(page.getByTestId('list-together')).toContainText('Together');
  await expect(page.getByTestId('list-together').getByRole('button', { name: 'Watch later', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('list-partner')).toContainText('Luz');
  await expect(page.getByTestId('list-partner')).toContainText('not on their list');
  // Only "You" is a radio group; the partner row has no controls but the recommendation.
  await expect(page.getByTestId('list-partner').getByRole('radio')).toHaveCount(0);

  const mine = page.getByRole('radiogroup', { name: 'Your status' });
  await expect(mine.getByRole('radio', { name: 'Not on my list' })).toHaveAttribute('aria-checked', 'true');
  await mine.getByRole('radio', { name: 'Watched', exact: true }).click();
  await expect(mine.getByRole('radio', { name: 'Watched', exact: true })).toHaveAttribute('aria-checked', 'true');
  const dates = page.getByRole('group', { name: 'Your watched date' });
  await dates.getByRole('button', { name: 'Yesterday' }).click();
  await expect(dates.getByRole('button', { name: 'Yesterday' })).toHaveAttribute('aria-pressed', 'true');
  await dates.getByLabel('Pick your date').fill('2024-01-05');
  await expect(dates.locator('time')).toHaveAttribute('datetime', '2024-01-05');
  await dates.getByRole('button', { name: 'Unknown' }).click();
  await expect(dates).toContainText('date unknown');
  // Together did not move.
  await expect(page.getByTestId('list-together').getByRole('button', { name: 'Watch later', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // A series: my own season, separate from Together's.
  await page.getByRole('link', { name: 'Back' }).click();
  await tab(page, 'Watching').click();
  await row(page, /The Simpsons/).click();
  await page.getByRole('radiogroup', { name: 'Your status' }).getByRole('radio', { name: 'Watching' }).click();
  await page.getByRole('button', { name: 'Next season (you)' }).click();
  await page.getByRole('button', { name: 'Next season (you)' }).click();
  await expect(page.getByRole('group', { name: 'Your current season' })).toContainText('Season 2');
  await expect(page.getByRole('group', { name: 'Current season', exact: true })).toContainText('Season 8');
  await page.getByRole('link', { name: 'Back' }).click();
  await switchTo(page, 'Ana');
  await expect(row(page, /The Simpsons.*Season 2/)).toBeVisible();
  await tab(page, 'Watched').click();
  await expect(row(page, /Inception/)).toBeVisible();
  await switchTo(page, 'Together');
  await tab(page, 'Watching').click();
  await expect(row(page, /The Simpsons.*Season 8/)).toBeVisible();
});

test('Add to: defaults to the list on screen; Just me stays off Together', async ({ page }) => {
  await startList(page, 'Ana');
  await importCatalogue(page);
  await tab(page, 'Watch later').click();
  const open = async () => {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    return page.getByRole('dialog', { name: 'Add a title' });
  };

  let sheet = await open();
  await expect(sheet.getByRole('radiogroup', { name: 'Add to' }).getByRole('radio')).toHaveText(['Together', 'Just me']);
  await expect(sheet.getByRole('radio', { name: 'Together' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  await switchTo(page, 'Luz');
  sheet = await open();
  await expect(sheet.getByRole('radio', { name: 'Together' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  await switchTo(page, 'Ana');
  sheet = await open();
  await expect(sheet.getByRole('radio', { name: 'Just me' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByLabel('Title').fill('Solo Film');
  await sheet.getByRole('button', { name: 'Add title' }).click();
  await expect(sheet).toBeHidden();
  await expect(row(page, /Solo Film/)).toBeVisible();
  await switchTo(page, 'Together');
  await expect(row(page, /Solo Film/)).toHaveCount(0);

  // Already on Together: Just me gives it a personal status and does not duplicate it.
  await switchTo(page, 'Ana');
  sheet = await open();
  await sheet.getByLabel('Title').fill('Inception');
  await sheet.getByLabel('Year').fill('2010');
  await sheet.getByRole('button', { name: 'Add title' }).click();
  await expect(sheet).toBeHidden();
  await expect(row(page, /Inception/)).toHaveCount(1);
  await switchTo(page, 'Together');
  await expect(row(page, /Inception/)).toHaveCount(1);
});

test('two devices: recommend, accept, dismiss, offline personal edits converge, partner list is view-only', async ({ page: a, newDevice }) => {
  test.setTimeout(90_000);
  const code = await startList(a, 'Ana');
  await addByHand(a, { title: 'Heat', year: '1995', status: 'Watched' });
  await addByHand(a, { title: 'Severance', kind: 'Series', year: '2022' });
  await addByHand(a, { title: 'Alien', year: '1979' });
  await syncNow(a);
  const { page: b } = await newDevice();
  await join(b, code, 'Luz');
  await syncNow(b);

  // A recommends Heat and Alien to Luz.
  await tab(a, 'Watched').click();
  await row(a, /Heat/).click();
  await a.getByRole('button', { name: 'Recommend to Luz' }).click();
  await expect(a.getByTestId('list-partner')).toContainText('Recommended');
  await a.getByRole('link', { name: 'Back' }).click();
  await tab(a, 'Watch later').click();
  await row(a, /Alien/).click();
  await a.getByRole('button', { name: 'Recommend to Luz' }).click();
  await expect(a.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await syncNow(a);
  await syncNow(b);

  // B sees both on their own Watch later, marked, and nothing on Together changed.
  await tab(b, 'Watch later').click();
  await switchTo(b, 'Luz');
  const recs = b.getByRole('list', { name: 'Recommended to you' });
  await expect(recs.getByText('Recommended by Ana')).toHaveCount(2);
  const accept = recs.getByRole('button', { name: 'Accept Heat' });
  expect((await accept.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await recs.getByRole('button', { name: 'Dismiss Alien' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await accept.click();
  await recs.getByRole('button', { name: 'Dismiss Alien' }).click();
  await expect(recs).toHaveCount(0);
  await expect(b.getByRole('list').getByRole('link', { name: /Heat/ })).toBeVisible();
  await expect(b.getByRole('link', { name: /Alien/ })).toHaveCount(0);
  await switchTo(b, 'Together');
  await tab(b, 'Watched').click();
  await expect(row(b, /Heat/)).toBeVisible();

  // A learns about the dismissal; Heat's recommendation was accepted, so no button is offered.
  await syncNow(b);
  await syncNow(a);
  await tab(a, 'Watch later').click();
  await row(a, /Alien/).click();
  await expect(a.getByTestId('list-partner')).toContainText('Dismissed by Luz');
  await expect(a.getByRole('button', { name: 'Recommend to Luz' })).toHaveCount(0);

  // Both set their own statuses while offline; nothing conflicts and Together does not move.
  await a.getByRole('link', { name: 'Back' }).click();
  await tab(a, 'Watch later').click();
  await row(a, /Severance/).click();
  await a.context().setOffline(true);
  await b.context().setOffline(true);
  await a.getByRole('radiogroup', { name: 'Your status' }).getByRole('radio', { name: 'Watching' }).click();
  await a.getByRole('button', { name: 'Next season (you)' }).click();
  await a.getByRole('button', { name: 'Next season (you)' }).click();
  await a.getByRole('link', { name: 'Back' }).click();
  await tab(b, 'Watched').click();
  await row(b, /Heat/).click();
  await b.getByRole('radiogroup', { name: 'Your status' }).getByRole('radio', { name: 'Watched', exact: true }).click();
  await b.getByRole('link', { name: 'Back' }).click();
  await a.context().setOffline(false);
  await b.context().setOffline(false);
  await syncNow(a);
  await syncNow(b);
  await syncNow(a);

  for (const p of [a, b]) {
    await tab(p, 'Watch later').click();
    await switchTo(p, 'Together');
    await expect(row(p, /Severance/)).toBeVisible();
    await tab(p, 'Watched').click();
    await expect(row(p, /Heat/)).toBeVisible();
  }
  await tab(b, 'Watching').click();
  await switchTo(b, 'Ana');
  await expect(b.getByTestId('whose')).toHaveText("Ana's list · view only");
  await expect(row(b, /Severance.*Season 2/)).toBeVisible();
  await expect(b.locator('.rows button')).toHaveCount(0);
  await row(b, /Severance/).click();
  await expect(b.getByTestId('list-partner')).toContainText('Ana');
  await expect(b.getByTestId('list-partner')).toContainText('Watching · Season 2');
  await expect(b.getByRole('group', { name: 'Status', exact: true })).toHaveCount(0);
  await expect(b.getByRole('button', { name: 'Remove from list' })).toHaveCount(0);
  await expect(b.getByRole('radiogroup', { name: 'Your status' })).toBeVisible();
  await expect(b.getByTestId('list-together')).toContainText('Watch later');

  await tab(a, 'Watched').click();
  await row(a, /Heat/).click();
  await expect(a.getByTestId('list-partner')).toContainText('Watched');
  await expect(you(a).getByRole('radio', { name: 'Not on my list' })).toHaveAttribute('aria-checked', 'true');
});
