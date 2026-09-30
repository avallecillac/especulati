import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SRC = join(import.meta.dirname, '..');

export const COLOUR_TOKENS = [
  'paper', 'leaf', 'ink', 'ink-soft', 'rule', 'accent', 'on-accent', 'ornament', 'butterfly', 'danger',
  'heat-0', 'heat-1', 'heat-2', 'heat-3', 'heat-4',
  'cloth-1', 'cloth-2', 'cloth-3', 'cloth-4', 'cloth-5', 'cloth-6', 'on-cloth',
  'bar', 'backdrop', 'texture',
];
export const OTHER_TOKENS = ['scheme', 'font-text', 'font-display', 'radius-group', 'radius-sheet'];

/** Declarations of a theme file: custom properties by name, plus any other property names. */
export function parseTheme(id: string): ParsedTheme {
  return parseThemeFile(join(SRC, 'theme', `${id}.css`));
}

export interface ParsedTheme { tokens: Map<string, string>; others: string[]; rules: number }

/** Same, for any theme CSS file (the test fixture uses this). */
export function parseThemeFile(path: string): ParsedTheme {
  const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map<string, string>();
  const others: string[] = [];
  for (const m of css.matchAll(/^\s*([a-z0-9-]+)\s*:\s*(.+?);\s*$/gm)) {
    const name = m[1]!;
    if (name.startsWith('--')) tokens.set(name.slice(2), m[2]!);
    else others.push(name);
  }
  return { tokens, others, rules: (css.match(/\{/g) ?? []).length };
}

export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
