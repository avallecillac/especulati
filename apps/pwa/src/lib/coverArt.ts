const ARTICLES = new Set(['the', 'a', 'an']);

/** Up to two uppercase initials from the first two words; "#" when there is nothing usable (e.g. "ISBN 978…"). */
export function initials(title: string): string {
  const t = title.trim();
  if (/^isbn\b/i.test(t)) return '#';
  let words = t.split(/\s+/).filter(Boolean);
  if (words.length > 1 && ARTICLES.has(words[0]!.toLowerCase())) words = words.slice(1);
  const out = words
    .slice(0, 2)
    .map((w) => [...w].find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? '')
    .join('')
    .toUpperCase();
  return out || '#';
}

/** Stable hash of `key` into a hue, 0..359. */
export function coverHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}
