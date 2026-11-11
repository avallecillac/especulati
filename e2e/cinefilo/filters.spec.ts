import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, startList, tab, test } from './fixtures.ts';

type Seed = { name: string; mine: string | null; partner: string | null };

const NOW = '2025-01-01T00:00:00.000Z';

/** Build a `cinefilo/v1` file around the member this device already is, and import it through Settings. */
export async function importSeed(page: Page, seeds: Seed[]): Promise<void> {
  await tab(page, 'Settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  const base = JSON.parse(await (await import('node:fs/promises')).readFile((await download.path()), 'utf8')) as { members: { id: string }[] };
  const me = base.members[0]!.id;
  const luz = randomUUID();
  const titles = seeds.map((s) => ({
    id: randomUUID(), kind: 'movie', title: s.name, originalTitle: null, year: 2000, tmdbId: null, posterUrl: null, genres: null,
    runtimeMin: null, seasonCount: null, status: 'watched', watchedOn: '2025-01-02', currentSeason: null, mergedInto: null,
    addedBy: me, createdAt: NOW, deletedAt: null,
  }));
  const ratings = seeds.flatMap((s, i) =>
    ([[me, s.mine], [luz, s.partner]] as const)
      .filter(([, v]) => v !== null)
      .map(([m, v]) => ({ id: randomUUID(), titleId: titles[i]!.id, memberId: m, verdict: v, review: null, updatedAt: NOW, deletedAt: null })),
  );
  const file = {
    format: 'cinefilo/v1', exportedAt: NOW, titles,
    members: [{ id: luz, name: 'Luz', createdAt: '2030-01-01T00:00:00.000Z', deletedAt: null }],
    ratings,
  };
  await page.locator('#import-file').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByText(`Imported ${titles.length + 1 + ratings.length} items.`)).toBeVisible();
}

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
  for (const [chip, names] of cases) {
    await page.getByRole('button', { name: chip }).click();
    await expect(rows).toHaveCount(names.length);
    for (const n of names) await expect(page.getByRole('link', { name: new RegExp(n) })).toBeVisible();
    await page.getByRole('button', { name: chip }).click(); // off again
  }
  await expect(rows).toHaveCount(5);
});
