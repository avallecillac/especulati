import { describe, expect, it } from 'vitest';
import { markMatches } from './markMatches.ts';

const text = (p: ReturnType<typeof markMatches>) => p.map((s) => (s.mark ? `[${s.text}]` : s.text)).join('');

describe('markMatches', () => {
  it('marks a term, ignoring case', () => {
    expect(text(markMatches('The Invisible Tapestry', 'tapestry'))).toBe('The Invisible [Tapestry]');
  });
  it('folds accents: "cafe" marks "Café" and "café" marks "Cafe"', () => {
    expect(text(markMatches('We met at the Café.', 'cafe'))).toBe('We met at the [Café].');
    expect(text(markMatches('Cafe au lait', 'café'))).toBe('[Cafe] au lait');
  });
  it('marks a decomposed accent as one piece', () => {
    expect(text(markMatches('Café time', 'cafe'))).toBe('[Café] time');
  });
  it('marks every term and merges overlaps', () => {
    expect(text(markMatches('red green red', 'red green'))).toBe('[red] [green] [red]');
    expect(text(markMatches('abcdef', 'abc cde'))).toBe('[abcde]f');
  });
  it('returns the text unmarked when nothing matches or the query is empty', () => {
    expect(markMatches('hello', '')).toEqual([{ text: 'hello', mark: false }]);
    expect(markMatches('hello', 'xyz')).toEqual([{ text: 'hello', mark: false }]);
  });
  it('clips a long passage to a window around the first match', () => {
    const long = `${'a '.repeat(200)}needle${' b'.repeat(200)}`;
    const out = markMatches(long, 'needle');
    const flat = text(out);
    expect(flat.length).toBeLessThan(300);
    expect(flat.startsWith('…')).toBe(true);
    expect(flat.endsWith('…')).toBe(true);
    expect(flat).toContain('[needle]');
  });
});
