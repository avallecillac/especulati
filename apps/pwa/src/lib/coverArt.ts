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

/** Stable hash of `key` into one of the six cloth colours, 1..6 (the theme's --cloth-n tokens). */
export function coverCloth(key: string): 1 | 2 | 3 | 4 | 5 | 6 {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ((h % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}
