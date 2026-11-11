import { normalize } from './normalize.mjs';

const LIST_HEADERS = { watched: 'watched', watch_later: 'later', watchlater: 'later' };
const TRILOGY = /^(trilogy|trilogia|saga|collection|coleccion|duology|tetralogy|quadrilogy|pentalogy)$/;
const KIND_TV = /^(serie|series|tv|miniserie|miniseries|tv series)$/;
const REPEAT = /^\d+\s*(a|ª|nd|st|rd|th)?\s*(vez|time|times|mal)$|^(re-?watch|rewatch|repeat)$/;
const NUM_LIST = /^(.*?\S)\s+(\d{1,2}(?:\s*(?:,|\by\b|\band\b|&|\bund\b)\s*\d{1,2})+)$/i;

/**
 * Parse the Keep export: a `watched` header, its lines, a `watch_later` header, its lines.
 * Returns `{ entries, dropped }`. Entry: `{ id, line, list, title, year?, hint?, kind?, note?, expand?, multi? }`.
 *  - `line` is the 1-based file line; `id` is `line` (or `line.n` for the parts of a multi-film line).
 *  - `expand: 'collection'` means "(trilogy)" and friends: the match step expands it from TMDB.
 *  - `multi: { base, number }` marks a numbered part ("Base 1, 2, 3" gives Base 1, Base 2, Base 3).
 * Assumption: a "/" splits two titles only when spaced ("A / B"), so "Face/Off" stays one title.
 */
export function parseList(text) {
  const entries = [];
  const dropped = [];
  let list = 'watched';
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    let s = raw.replace(/^\s*(?:[-*•]|\[[ xX]?\])\s+/, '').replace(/\*+/g, '').trim();
    if (!s) return;
    const header = LIST_HEADERS[normalize(s).replace(/ /g, '_')] ?? LIST_HEADERS[normalize(s).replace(/ /g, '')];
    if (header) {
      list = header;
      return;
    }
    for (const part of splitLine(s)) {
      for (const e of expandPart(part, line, list)) {
        const prev = entries.find(
          (x) => normalize(x.title) === normalize(e.title) && (!x.year || !e.year || x.year === e.year) && (!x.kind || !e.kind || x.kind === e.kind),
        );
        if (prev) {
          dropped.push({ id: e.id, line, list, title: e.title, reason: 'duplicate', of: prev.id });
          continue;
        }
        entries.push(e);
      }
    }
  });
  return { entries, dropped };
}

function splitLine(s) {
  // Split "A / B" but never inside parentheses.
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    const spaced = /\s/.test(s[i - 1] ?? '') || /\s/.test(s[i + 1] ?? '');
    if (c === '/' && depth === 0 && spaced) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

function expandPart(s, line, list) {
  const notes = [];
  let year;
  let kind;
  let expand;
  let repeat = false;
  s = s.replace(/\(([^()]*)\)/g, (_, inner) => {
    const t = inner.trim();
    const n = normalize(t);
    if (/^(19|20)\d{2}$/.test(t)) year = Number(t);
    else if (TRILOGY.test(n)) expand = 'collection';
    else if (KIND_TV.test(n)) kind = 'series';
    else if (REPEAT.test(n)) repeat = true;
    else notes.push(t);
    return ' ';
  });
  s = s.replace(/\s+/g, ' ').trim();
  let hint;
  const dash = s.match(/^(.*?\S)\s+[-–—]\s+(\S.*)$/);
  if (dash) {
    s = dash[1];
    hint = dash[2].trim();
  }
  if (repeat) notes.push('repeat');
  const base = { line, list, ...(year ? { year } : {}), ...(hint ? { hint } : {}), ...(kind ? { kind } : {}), ...(notes.length ? { note: notes.join('; ') } : {}) };
  const m = !expand && s.match(NUM_LIST);
  if (m) {
    const nums = m[2].split(/\s*(?:,|\by\b|\band\b|&|\bund\b)\s*/i).map(Number);
    return nums.map((n, i) => ({ id: `${line}.${i + 1}`, ...base, title: `${m[1]} ${n}`, multi: { base: m[1], number: n } }));
  }
  if (!s) return [];
  return [{ id: String(line), ...base, title: s, ...(expand ? { expand } : {}) }];
}
