import { describe, expect, it } from 'vitest';
import { searchKey } from '../src/index.ts';

describe('searchKey', () => {
  it('folds accents and case', () => {
    expect(searchKey('Café')).toBe('cafe');
    expect(searchKey('ÑANDÚ')).toBe('nandu');
  });
  it('leaves plain text lower-cased', () => {
    expect(searchKey('Hello World')).toBe('hello world');
    expect(searchKey('')).toBe('');
  });
});
