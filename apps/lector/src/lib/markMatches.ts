import { searchKey } from '@especulati/lector-core';

export interface Piece {
  text: string;
  mark: boolean;
}

const WINDOW = 80;

/**
 * Split `passage` into pieces, marking where any term of `query` matches. Matching is on the folded text
 * (`searchKey`: accents and case ignored, as the index does), mapped back to positions in the original, so
 * "cafe" marks "Café". A long passage is clipped to a window around the first match.
 */
export function markMatches(passage: string, query: string): Piece[] {
  const terms = searchKey(query).split(/\s+/).filter((t) => t !== '');
  // folded[i] came from passage[from[i] .. to[i]); a combining mark folds to nothing and joins the previous unit.
  let folded = '';
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < passage.length; ) {
    const ch = String.fromCodePoint(passage.codePointAt(i)!);
    const f = searchKey(ch);
    if (f === '' && to.length > 0) to[to.length - 1] = i + ch.length;
    else
      for (const unit of f) {
        for (let k = 0; k < unit.length; k++) {
          folded += unit[k];
          from.push(i);
          to.push(i + ch.length);
        }
      }
    i += ch.length;
  }
  const ranges: [number, number][] = [];
  for (const t of terms) {
    for (let at = folded.indexOf(t); at !== -1; at = folded.indexOf(t, at + t.length)) {
      ranges.push([from[at]!, to[at + t.length - 1]!]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  if (merged.length === 0) return [{ text: passage, mark: false }];

  let lo = 0;
  let hi = passage.length;
  if (passage.length > 2 * WINDOW + 40) {
    lo = Math.max(0, merged[0]![0] - WINDOW);
    hi = Math.min(passage.length, merged[0]![0] + WINDOW + 40);
  }
  const out: Piece[] = [];
  const push = (text: string, mark: boolean) => text !== '' && out.push({ text, mark });
  if (lo > 0) push('…', false);
  let pos = lo;
  for (const [a, b] of merged) {
    if (b <= lo || a >= hi) continue;
    const s = Math.max(a, lo);
    const e = Math.min(b, hi);
    push(passage.slice(pos, s), false);
    push(passage.slice(s, e), true);
    pos = e;
  }
  push(passage.slice(pos, hi), false);
  if (hi < passage.length) push('…', false);
  return out;
}
