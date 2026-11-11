/** Research R5: NFD, strip combining marks, lower-case. "Café" and "cafe" share a key. */
export function searchKey(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}
