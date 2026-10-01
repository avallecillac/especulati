import { test, expect } from '@playwright/test';
import { forceTheme, screens, settle, seedScreens, THEMES } from './screens.ts';

// SC-007: nothing scrolls sideways at 320 px, even with very long text.
const LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(2);
const LONG_TITLE = `${LONG_WORD} ${'a long title that keeps going '.repeat(3)}`.slice(0, 120);
const LONG_AUTHOR = 'Wolfeschlegelsteinhausenbergerdorff-Wolfeschlegelsteinhausen Longauthorname';
const LONG_URL = `https://extremely-long-subdomain-name-for-testing.${'verylongpathsegment'.repeat(6)}.example.com/${'a'.repeat(80)}?x=1`;

test.use({ viewport: { width: 320, height: 640 } });

for (const theme of THEMES) {
  test(`layout: no horizontal overflow at 320 px in ${theme}`, async ({ page }) => {
    await forceTheme(page, theme);
    const seeded = await seedScreens(page, {
      reading: { title: LONG_TITLE, author: LONG_AUTHOR },
      queued: { title: LONG_TITLE.split('').reverse().join(''), author: LONG_AUTHOR },
      article: { url: LONG_URL, title: LONG_TITLE, author: LONG_AUTHOR },
    });

    const failures: string[] = [];
    for (const screen of screens(seeded)) {
      await screen.go(page);
      await settle(page);
      const m = await page.evaluate(() => {
        const main = document.querySelector('main');
        // Elements whose box reaches past the viewport or whose own content spills out of it.
        const wide = Array.from(document.querySelectorAll('body *'))
          .filter((e) => {
            if (e.closest('svg') || getComputedStyle(e).position === 'fixed') return false;
            const scrollsOnPurpose = ['auto', 'scroll'].includes(getComputedStyle(e).overflowX);
            return e.getBoundingClientRect().right > 320.5 || (!scrollsOnPurpose && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0);
          })
          .slice(0, 4)
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute('class'))}`);
        return {
          doc: document.documentElement.scrollWidth,
          mainScroll: main ? main.scrollWidth : 0,
          mainClient: main ? main.clientWidth : 0,
          wide,
        };
      });
      if (m.doc > 320 || m.mainScroll > m.mainClient) failures.push(`[${screen.name}] ${JSON.stringify(m)}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
