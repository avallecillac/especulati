/** Stable hash of `key` into one of six placeholder tints, 1..6 (the `.cloth-n` classes in app.css, built from theme tokens). */
export function coverCloth(key: string): 1 | 2 | 3 | 4 | 5 | 6 {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ((h % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}
