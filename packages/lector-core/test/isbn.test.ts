import { describe, expect, it } from 'vitest';
import { parseCoverUrl, parseIsbn, type Result } from '../src/index.ts';

const val = <T>(r: Result<T, unknown>): T | undefined => { expect(r.ok).toBe(true); return r.ok ? r.value : undefined; };
const rejected = (r: Result<unknown, { field: string }>, field: string) => {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.field).toBe(field);
};

describe('parseIsbn (research R6)', () => {
  it.each([
    ['0-441-47812-3', '9780441478125'],
    ['978-0-441-17271-9', '9780441172719'],
    ['080442957X', '9780804429573'],
    ['9790001234566', '9790001234566'],
  ])('%s → %s', (input, expected) => expect(val(parseIsbn(input))).toBe(expected));

  it('rejects a bad ISBN-13 check digit', () => rejected(parseIsbn('9780441172718'), 'isbn'));
  it('accepts spaces and a lowercase x', () => {
    expect(val(parseIsbn(' 080442957x '))).toBe('9780804429573');
    expect(val(parseIsbn('978 0 441 17271 9'))).toBe('9780441172719');
  });
  it('rejects wrong lengths, letters, a 977 prefix and a bad ISBN-10 check digit', () => {
    for (const s of ['', '123', '97804411727', '97804411727199', 'abcdefghij', '97804411727X9', '9770441172719', '0-441-47812-4', '0441478X23'])
      rejected(parseIsbn(s), 'isbn');
  });
});

describe('parseCoverUrl: https only, at most 500 characters', () => {
  it('accepts https', () => expect(val(parseCoverUrl('https://covers.example/x.jpg'))).toBe('https://covers.example/x.jpg'));
  it('accepts exactly 500 characters', () => expect(val(parseCoverUrl('https://' + 'a'.repeat(492)))).toHaveLength(500));
  it('rejects http, javascript: and over 500 characters', () => {
    rejected(parseCoverUrl('http://x.example/a.jpg'), 'coverUrl');
    rejected(parseCoverUrl('javascript:alert(1)'), 'coverUrl');
    rejected(parseCoverUrl('https://' + 'a'.repeat(493)), 'coverUrl');
  });
});
