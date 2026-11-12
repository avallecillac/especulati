import { expect, startList, tab, test } from './fixtures.ts';
import { importSeed } from './seed.ts';

test.use({ viewport: { width: 390, height: 844 } });

test('each verdict filter lists the right titles, offline', async ({ page, context }) => {
  await startList(page, 'Ana');
  await importSeed(page, [
    { name: 'Both', mine: 'like', partner: 'like' },
    { name: 'Split', mine: 'like', partner: 'dislike' },
    { name: 'OnlyMine', mine: 'meh', partner: null },
    { name: 'OnlyHers', mine: null, partner: 'like' },
    { name: 'Neither', mine: null, partner: null },
  ]);
  await context.setOffline(true);
  await tab(page, 'Watched').click();
  const rows = page.getByRole('list').getByRole('link');
  await expect(rows).toHaveCount(5);

  const cases: [string, string[]][] = [
    ['Both liked', ['Both']],
    ['Disagree', ['Split']],
    ['Only me', ['OnlyMine']],
    ["Partner hasn't rated", ['OnlyMine', 'Neither']],
    ['Nobody rated', ['Neither']],
  ];
  const filterButton = page.getByRole('button', { name: 'Filter', exact: true });
  for (const [label, names] of cases) {
    await filterButton.click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await expect(sheet.getByRole('radiogroup', { name: 'Verdict' }).getByRole('radio')).toHaveCount(6); // All + five filters
    await sheet.getByRole('radio', { name: label, exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(filterButton).toBeFocused();
    await expect(rows).toHaveCount(names.length);
    for (const n of names) await expect(page.getByRole('link', { name: new RegExp(n) })).toBeVisible();
    // One removable chip names the filter; removing it brings everything back.
    await page.getByRole('button', { name: `Remove filter ${label}` }).click();
    await expect(rows).toHaveCount(5);
    await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(0);
  }
  await expect(rows).toHaveCount(5);

  // Escape and the backdrop close the sheet without changing the filter; "All" clears it.
  await filterButton.click();
  await expect(filterButton).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Filter' })).toBeHidden();
  await filterButton.click();
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('radio', { name: 'Disagree' }).click();
  await filterButton.click();
  await page.mouse.click(195, 40); // the backdrop, above the sheet
  await expect(page.getByRole('dialog', { name: 'Filter' })).toBeHidden();
  await expect(rows).toHaveCount(1);
  await filterButton.click();
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('radio', { name: 'All' }).click();
  await expect(rows).toHaveCount(5);
});
