import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Design D3: the precached (latin) fonts stay under 400 KB; latin-ext loads on demand.
const APP = fileURLToPath(new URL('../..', import.meta.url));
const FONTS = join(APP, 'public/fonts');
const precached = (f: string) => /\.woff2$/.test(f) && /-latin-(wght|\d+)-normal\.woff2$/.test(f);

describe('size budget', () => {
  it('precached latin fonts are under 400 KB', () => {
    const files = readdirSync(FONTS).filter(precached);
    expect(files.length).toBe(6);
    const total = files.reduce((sum, f) => sum + statSync(join(FONTS, f)).size, 0);
    expect(total).toBeLessThan(400 * 1024);
  });

  it('the service worker precaches only the latin font subsets', () => {
    const config = readFileSync(join(APP, 'vite.config.ts'), 'utf8');
    const globs = /globPatterns:\s*\[(.*)\],/.exec(config)?.[1] ?? '';
    const fontGlobs = [...globs.matchAll(/'([^']*fonts[^']*)'/g)].map((m) => m[1]);
    expect(fontGlobs).toEqual(['fonts/*-latin-wght-*.woff2', 'fonts/*-latin-[0-9]*-normal.woff2']);
    expect(globs).not.toMatch(/woff2?\}/);
  });

  it('ships an OFL licence for every family and no third-party font requests', () => {
    const names = readdirSync(FONTS);
    for (const fam of ['archivo', 'ibm-plex-mono', 'italiana', 'libre-caslon-display', 'inter']) {
      expect(names).toContain(`OFL-${fam}.txt`);
    }
    const css = readFileSync(join(APP, 'src/theme/fonts.css'), 'utf8');
    expect(css).not.toMatch(/googleapis|gstatic|https?:/);
  });
});
