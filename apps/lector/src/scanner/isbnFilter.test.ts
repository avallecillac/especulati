import { describe, expect, it } from 'vitest';
import { isbnFromBarcode } from './isbnFilter.ts';

describe('isbnFromBarcode', () => {
  it('accepts a 978 EAN-13', () => {
    expect(isbnFromBarcode('9780441172719')).toBe('9780441172719');
  });
  it('accepts a 979 (not 9790) EAN-13', () => {
    expect(isbnFromBarcode('9791299999991')).toBe('9791299999991');
  });
  it('rejects UPC-A (12 digits)', () => {
    expect(isbnFromBarcode('012345678905')).toBeNull();
  });
  it('rejects 9790 (ISMN, music) even with a valid check digit', () => {
    expect(isbnFromBarcode('9790001234566')).toBeNull();
  });
  it('rejects a bad check digit', () => {
    expect(isbnFromBarcode('9780441172718')).toBeNull();
  });
  it('rejects non-numeric text and ISBN-10', () => {
    expect(isbnFromBarcode('978044117271X')).toBeNull();
    expect(isbnFromBarcode('0441172717')).toBeNull();
    expect(isbnFromBarcode('978-0-441-17271-9')).toBeNull();
    expect(isbnFromBarcode('')).toBeNull();
  });
});
