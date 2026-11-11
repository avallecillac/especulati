import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEMES, resolveTheme } from './themes.ts';
import { SRC } from './theme-files.ts';

// The pre-paint script in index.html hard-codes theme ids and bar colours (it runs before any module).
// This runs it against every stored value and system preference and checks it agrees with THEMES.
const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

function run(stored: string | null, dark: boolean) {
  const meta = { content: '#f3ecdd' };
  const doc = { documentElement: { dataset: {} as Record<string, string> }, querySelector: () => meta };
  runInNewContext(script!, {
    document: doc,
    matchMedia: () => ({ matches: dark }),
    localStorage: { getItem: () => stored },
  });
  return { theme: doc.documentElement.dataset['theme'], color: meta.content };
}

describe('index.html pre-paint script', () => {
  it('is present', () => {
    expect(script).toBeTruthy();
  });

  for (const dark of [false, true]) {
    for (const stored of [null, 'automatic', 'nonsense', ...THEMES.map((t) => t.id)]) {
      it(`matches THEMES for stored=${stored} systemDark=${dark}`, () => {
        const id = resolveTheme(stored, dark);
        const theme = THEMES.find((t) => t.id === id)!;
        expect(run(stored, dark)).toEqual({ theme: id, color: theme.themeColor });
      });
    }
  }

  it('the static theme-color meta is the default light theme colour', () => {
    const m = /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1];
    expect(m).toBe(THEMES.find((t) => t.id === resolveTheme(null, false))!.themeColor);
  });
});
