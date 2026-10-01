import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { forceTheme, screens, settle, seedScreens, THEMES, type Seeded } from './screens.ts';

// SC-006: no serious or critical WCAG 2 A/AA violations on any screen, in both themes.
for (const theme of THEMES) {
  test(`a11y: every screen in ${theme}`, async ({ page }) => {
    await forceTheme(page, theme);
    const seeded: Seeded = await seedScreens(page, {
      reading: { title: 'One Hundred Years of Solitude', author: 'Gabriel García Márquez' },
      queued: { title: 'The Autumn of the Patriarch', author: 'Gabriel García Márquez' },
      article: { url: 'https://www.example.com/read/essay', title: 'A Long Essay', author: 'Ann Author' },
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const failures: string[] = [];
    for (const screen of screens(seeded)) {
      await screen.go(page);
      // Let fonts, images and any entry animation settle before scanning.
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of results.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
        failures.push(`[${screen.name}] ${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ') + ' :: ' + (n.any[0]?.message ?? n.failureSummary ?? '')).join(' | ')}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
