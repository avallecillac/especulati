import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SRC = join(import.meta.dirname, '..');

/** The token contract (openspec add-cinefilo-themes, design D1). Each theme file sets exactly these. */
export const COLOUR_TOKENS = [
  'bg', 'surface', 'surface-2', 'ink', 'ink-soft', 'rule', 'hairline', 'accent', 'on-accent', 'both-loved',
  'danger', 'like', 'meh', 'dislike', 'bar', 'backdrop',
];
export const OTHER_TOKENS = [
  'font-title', 'font-text', 'font-label', 'radius', 'radius-sheet', 'radius-pill', 'rule-width', 'poster-filter',
];

export interface ParsedTheme { tokens: Map<string, string>; others: string[]; rules: number }

/** Declarations of a theme file: custom properties by name, plus any other property names. */
export function parseTheme(id: string): ParsedTheme {
  const css = readFileSync(join(SRC, 'theme', `${id}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map<string, string>();
  const others: string[] = [];
  const bodies = [...css.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!);
  for (const decl of bodies.join(';').split(';')) {
    const m = /^\s*([a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
    if (!m) continue;
    const name = m[1]!;
    if (name.startsWith('--')) tokens.set(name.slice(2), m[2]!.replace(/\s+/g, ' '));
    else others.push(name);
  }
  return { tokens, others, rules: (css.match(/\{/g) ?? []).length };
}

export function selectorOf(id: string): string {
  const css = readFileSync(join(SRC, 'theme', `${id}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return css.slice(0, css.indexOf('{')).trim();
}

export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
