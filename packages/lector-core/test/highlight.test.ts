import { describe, expect, it } from 'vitest';
import { NOTE_MAX, QUOTE_MAX, normalizeNote, normalizeQuote, passageUrl, textFragment } from '../src/index.ts';

const q = (s: string) => {
  const r = normalizeQuote(s);
  if (!r.ok) throw new Error('rejected');
  return r.value;
};

describe('normalizeQuote', () => {
  it('turns CRLF and CR into LF', () => {
    expect(q('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('collapses spaces, tabs and NBSP within a line, and trims each line', () => {
    expect(q('  a \t b  c  \n   d   ')).toBe('a b c\nd');
  });

  it('turns 3 or more newlines into 2', () => {
    expect(q('a\n\n\n\nb')).toBe('a\n\nb');
    expect(q('a\n\nb')).toBe('a\n\nb');
    expect(q('a\n  \n  \nb')).toBe('a\n\nb');
  });

  it('gives null for an empty result', () => {
    expect(q('')).toBeNull();
    expect(q(' \t\n  \r\n ')).toBeNull();
  });

  it('accepts exactly 5,000 code points unchanged and rejects 5,001', () => {
    const ok = 'a'.repeat(QUOTE_MAX);
    expect(q(ok)).toBe(ok);
    expect(normalizeQuote('a'.repeat(QUOTE_MAX + 1))).toEqual({ ok: false, error: { kind: 'TooLong', max: 5000 } });
  });

  it('counts code points, not UTF-16 units', () => {
    const ok = '😀'.repeat(QUOTE_MAX);
    expect(q(ok)).toBe(ok);
    expect(normalizeQuote('😀'.repeat(QUOTE_MAX + 1)).ok).toBe(false);
  });
});

describe('normalizeNote', () => {
  it('keeps internal spacing but trims, fixes newlines and squashes 3+ newlines', () => {
    const r = normalizeNote('  a   b\t c\r\n\r\n\r\n\r\nd  ');
    expect(r).toEqual({ ok: true, value: 'a   b\t c\n\nd' });
  });

  it('gives null when empty', () => {
    expect(normalizeNote('  \n ')).toEqual({ ok: true, value: null });
  });

  it('caps at 5,000 code points', () => {
    expect(normalizeNote('n'.repeat(NOTE_MAX)).ok).toBe(true);
    expect(normalizeNote('n'.repeat(NOTE_MAX + 1))).toEqual({ ok: false, error: { kind: 'TooLong', max: 5000 } });
  });
});

describe('textFragment', () => {
  it('uses the whole quote for 8 words or fewer', () => {
    expect(textFragment('First passage')).toBe('#:~:text=First%20passage');
    expect(textFragment('one two three four five six seven eight')).toBe('#:~:text=one%20two%20three%20four%20five%20six%20seven%20eight');
  });

  it('uses the first 4 and last 4 words for longer quotes', () => {
    expect(textFragment('one two three four five six seven eight nine')).toBe(
      '#:~:text=one%20two%20three%20four,six%20seven%20eight%20nine',
    );
  });

  it('percent-encodes -, ",", & and #', () => {
    const f = textFragment('well-known, a&b #1');
    expect(f).toBe('#:~:text=well%2Dknown%2C%20a%26b%20%231');
    expect(f.slice('#:~:text='.length)).not.toMatch(/[-,&#]/);
  });

  it('keeps one raw comma between the first and last words only', () => {
    const f = textFragment('a-b, c d e f g h i j-k, l');
    expect(f.slice('#:~:text='.length).split(',')).toHaveLength(2);
  });

  it('turns line breaks into spaces', () => {
    expect(textFragment('a\nb\r\nc\n\nd')).toBe('#:~:text=a%20b%20c%20d');
  });

  it('survives a lone surrogate', () => {
    expect(() => textFragment('bad \ud800 text')).not.toThrow();
  });
});

describe('passageUrl', () => {
  it('is the url when the quote is null', () => {
    expect(passageUrl('https://example.com/a', null)).toBe('https://example.com/a');
  });

  it('appends the fragment', () => {
    expect(passageUrl('https://example.com/a', 'First passage')).toBe('https://example.com/a#:~:text=First%20passage');
  });
});
