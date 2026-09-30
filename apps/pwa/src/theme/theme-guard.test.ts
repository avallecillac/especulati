import { readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, walk } from './theme-files.ts';

// FR-020: no literal colours outside src/theme (research R6).
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

/** Files that may hold literals entirely: the camera view must stay black and white. */
const ALLOWED_FILES = new Set(['Scan.svelte']);
/** Lines that may hold literals: camera/QR rules and black backdrops. */
const ALLOWED_LINES: RegExp[] = [
  /\.scan-/,
  /\.qr\b/,
  /rgb\(\s*0 0 0 \/ [\d.]+\s*\)/,
  // TEMPORARY: remove in T011 (Cover.svelte moves to cloth tokens).
  /hsl\(\$\{coverHue/,
];

describe('no literal colours outside src/theme', () => {
  const files = walk(SRC).filter(
    (f) => /\.(svelte|css)$/.test(f) && !f.startsWith(join(SRC, 'theme') + '/'),
  );

  it('scans something', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [relative(SRC, f), f] as const))('%s', (_rel, file) => {
    if (ALLOWED_FILES.has(basename(file))) return;
    const offenders = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => LITERAL.test(line) && !ALLOWED_LINES.some((re) => re.test(line)))
      .map(({ line, n }) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
