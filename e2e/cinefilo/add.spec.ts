import { addByHand, expect, startList, test } from './fixtures.ts';

test('add by hand offline, then a duplicate opens the existing entry', async ({ page, context }) => {
  await startList(page, 'Ana');
  await context.setOffline(true);
  await addByHand(page, { title: 'Stalker', year: '1979' });
  await expect(page.getByRole('link', { name: /Stalker/ })).toBeVisible();

  // Case and accents do not make a second entry.
  await addByHand(page, { title: 'Amélie', year: '2001' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a title' });
  await sheet.getByLabel('Title').fill('amelie');
  await sheet.getByLabel('Year').fill('2001');
  await sheet.getByRole('button', { name: 'Add title' }).click();
  await expect(page).toHaveURL(/#\/title\//);
  await expect(page.getByRole('heading', { name: 'Amélie' })).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('link', { name: /Amélie|amelie/i })).toHaveCount(1);
});

test('a blank title is rejected, a different year is a separate entry', async ({ page }) => {
  await startList(page, 'Ana');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a title' });
  await sheet.getByLabel('Title').fill('   ');
  await sheet.getByRole('button', { name: 'Add title' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('A title is required.');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await addByHand(page, { title: 'Solaris', year: '1972' });
  await addByHand(page, { title: 'Solaris', year: '2002' });
  await expect(page.getByRole('link', { name: /Solaris/ })).toHaveCount(2);
});
