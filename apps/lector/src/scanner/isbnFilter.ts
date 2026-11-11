import { parseIsbn, type Isbn13 } from '@especulati/lector-core';

/**
 * Accept a scanned EAN-13 only if it is a book ("Bookland") code: exactly 13 digits,
 * prefix 978, or 979 but not 9790 (ISMN, music), and a valid ISBN-13 (research R3).
 */
export function isbnFromBarcode(text: string): Isbn13 | null {
  if (!/^\d{13}$/.test(text)) return null;
  if (!(text.startsWith('978') || (text.startsWith('979') && !text.startsWith('9790')))) return null;
  const parsed = parseIsbn(text);
  return parsed.ok ? parsed.value : null;
}
