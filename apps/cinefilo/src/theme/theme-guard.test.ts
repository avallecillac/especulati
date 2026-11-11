import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..');
// No literal colours outside src/theme (same guard as lector's 006): screens use tokens only.
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('no literal colours outside src/theme', () => {
  const files = walk(SRC).filter((f) => /\.(svelte|css)$/.test(f) && !f.startsWith(join(SRC, 'theme') + '/'));

  it('scans something', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [relative(SRC, f), f] as const))('%s', (_rel, file) => {
    const offenders = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => LITERAL.test(line))
      .map(({ line, n }) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });

  it('the theme files define the tokens screens rely on', () => {
    for (const id of ['beton', 'willis']) {
      const css = readFileSync(join(SRC, 'theme', `${id}.css`), 'utf8');
      for (const t of ['bg', 'surface', 'ink', 'ink-soft', 'rule', 'control-border', 'accent', 'on-accent', 'danger', 'like', 'meh', 'dislike', 'backdrop', 'font-title', 'font-label']) {
        expect(css).toContain(`--${t}:`);
      }
    }
  });

  it('screening-room.css is gone and --font-display is not used', () => {
    expect(readdirSync(join(SRC, 'theme'))).not.toContain('screening-room.css');
    const offenders = walk(SRC).filter((f) => /\.(svelte|css|ts)$/.test(f) && !f.endsWith('.test.ts') && readFileSync(f, 'utf8').includes('var(--font-display)'));
    expect(offenders).toEqual([]);
  });
});

describe('control borders use --control-border; --rule and --hairline stay decorative', () => {
  const css = readFileSync(join(SRC, 'app.css'), 'utf8');
  it('the shared control rule borders with --control-border', () => {
    const i = css.indexOf('button, .button, input, select, textarea {');
    const body = css.slice(i, css.indexOf('}', i));
    expect(body).toContain('border: var(--rule-width) solid var(--control-border)');
    expect(body).not.toContain('var(--rule)');
  });
  it('no control selector borders with --rule or --hairline', () => {
    const offenders = css.split('\n').filter((l) => /(button|input|select|textarea|\.chip|\.stepper|\.seg)/.test(l.split('{')[0]!) && /border[^;]*var\(--(rule|hairline)\)/.test(l));
    expect(offenders).toEqual([]);
  });
});
