import { normalize } from './normalize.mjs';

export const TITLES_FORMAT = 'cinefilo-titles/v1';
const STATUSES = ['later', 'watching', 'watched'];

/** Local mirror of `parseTitlesFile` (D2): returns a list of problems, empty when the file is valid. */
export function validateTitlesFile(file) {
  const errs = [];
  if (!file || typeof file !== 'object' || file.format !== TITLES_FORMAT) return [`format must be "${TITLES_FORMAT}"`];
  if (!Array.isArray(file.titles)) return ['titles must be an array'];
  const allowed = new Set(['tmdbId', 'kind', 'title', 'year', 'status']);
  file.titles.forEach((t, i) => {
    const at = `titles[${i}]`;
    if (!t || typeof t !== 'object') return errs.push(`${at} must be an object`);
    for (const k of Object.keys(t)) if (!allowed.has(k)) errs.push(`${at}.${k} is not allowed`);
    if (t.kind !== 'movie' && t.kind !== 'series') errs.push(`${at}.kind must be movie or series`);
    if (typeof t.title !== 'string' || !t.title.trim()) errs.push(`${at}.title must be a non-empty string`);
    if (!STATUSES.includes(t.status)) errs.push(`${at}.status must be later, watching or watched`);
    if (t.status === 'watching' && t.kind !== 'series') errs.push(`${at}.status watching is only for series`);
    if ('tmdbId' in t && !(Number.isInteger(t.tmdbId) && t.tmdbId > 0)) errs.push(`${at}.tmdbId must be a positive integer`);
    if ('year' in t && !(Number.isInteger(t.year) && t.year >= 1870 && t.year <= 2200)) errs.push(`${at}.year must be a year`);
  });
  return errs;
}

const statusOf = (list) => (list === 'later' ? 'later' : 'watched');

/**
 * Combine matches and decisions into the file. Decision per id: a number 1..5 (candidate), 0 (skip), "m" (manual),
 * or an explicit `{ tmdbId, kind, title, year? }` (or a list of them) from a corrected search.
 * Confident matches need no decision (a decision still overrides). Returns `{ file, summary, pending }`.
 */
export function buildTitles(matches, decisions = {}) {
  const titles = [];
  const seen = new Set();
  const summary = { watched: 0, later: 0, skipped: 0, manual: 0, pending: 0, duplicates: 0 };
  const pending = [];
  const push = (entry, list) => {
    const key = entry.tmdbId ? `${entry.kind}:${entry.tmdbId}` : `m:${entry.kind}:${normalize(entry.title)}:${entry.year ?? ''}`;
    if (seen.has(key)) return void summary.duplicates++;
    seen.add(key);
    titles.push(entry);
    summary[statusOf(list)]++;
  };
  for (const m of matches) {
    const d = decisions[m.id];
    const status = statusOf(m.list);
    if (d === 0 || d === '0') {
      summary.skipped++;
    } else if (d === 'm') {
      summary.manual++;
      push({ kind: m.kind ?? 'movie', title: m.title, ...(m.year ? { year: m.year } : {}), status }, m.list);
    } else if (d && typeof d === 'object') {
      // An explicit pick from a corrected search: one { tmdbId, kind, title, year? } or a list of them
      // (a line naming several films, like "Meet the parents/Meet the Fockers").
      for (const pick of Array.isArray(d) ? d : [d]) push(fromCandidate(pick, status), m.list);
    } else if (Number.isInteger(d) && m.candidates[d - 1]) {
      push(fromCandidate(m.candidates[d - 1], status), m.list);
    } else if (d === undefined && m.status === 'confident') {
      push(fromCandidate(m.chosen, status), m.list);
    } else {
      summary.pending++;
      pending.push(m.id);
    }
  }
  const file = { format: TITLES_FORMAT, titles };
  const problems = validateTitlesFile(file);
  if (problems.length) throw new Error(`invalid titles file: ${problems.join('; ')}`);
  return { file, summary, pending };
}

const fromCandidate = (c, status) => ({ tmdbId: c.tmdbId, kind: c.kind, title: c.title, ...(c.year ? { year: c.year } : {}), status });
