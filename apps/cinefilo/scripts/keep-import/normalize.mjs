/** Same normalization as cinefilo-core's `titleKey` (NFKD, strip marks, lowercase, collapse punctuation). */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

export function jaro(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
}

export function jaroWinkler(a, b) {
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

/**
 * Similarity in [0,1] of two titles. Jaro-Winkler on the normalized strings (and on their sorted tokens, for
 * reordered words), scaled down when the lengths differ a lot so "Nine" does not match "Nine Lives" confidently.
 */
export function similarity(x, y) {
  const a = normalize(x);
  const b = normalize(y);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sorted = (s) => s.split(' ').sort().join(' ');
  const raw = Math.max(jaroWinkler(a, b), jaroWinkler(sorted(a), sorted(b)));
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return Math.min(1, raw * (0.5 + 0.5 * ratio));
}
