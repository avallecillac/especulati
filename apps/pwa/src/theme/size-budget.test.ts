import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// SC-002 / research R1: the precached fonts plus the ornament code stay under 400 KB.
const PWA = fileURLToPath(new URL('../..', import.meta.url));
const size = (dir: string, match: RegExp) =>
  readdirSync(dir).filter((f) => match.test(f)).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);

describe('size budget', () => {
  it('precached latin fonts + ornaments are under 400 KB', () => {
    const fonts = size(join(PWA, 'public/fonts'), /-latin-wght-.*\.woff2$/);
    const ornaments = size(join(PWA, 'src/ornaments'), /\.svelte$/);
    expect(fonts).toBeGreaterThan(0);
    expect(ornaments).toBeGreaterThan(0);
    expect(fonts + ornaments).toBeLessThan(400 * 1024);
  });

  it('the service worker precaches only the latin font subsets', () => {
    const config = readFileSync(join(PWA, 'vite.config.ts'), 'utf8');
    const globs = /globPatterns:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
    const fontGlobs = [...globs.matchAll(/'([^']*font[^']*)'/g)].map((m) => m[1]);
    expect(fontGlobs).toEqual(['fonts/*-latin-wght-*.woff2']);
    expect(globs).not.toMatch(/woff2?\}|\*\*\/\*\.\{[^}]*woff/);
  });
});
