import { similarity } from './normalize.mjs';

export const CONFIDENT_SCORE = 0.9;
export const CONFIDENT_LEAD = 0.1;
const yearOf = (d) => (typeof d === 'string' && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined);

/** Turn a TMDB search/multi, search/movie or search/tv result into a candidate (or undefined for people etc.). */
export function toCandidate(r, forcedType) {
  const type = r.media_type ?? forcedType;
  if (type === 'movie') {
    return { tmdbId: r.id, kind: 'movie', title: r.title ?? '', originalTitle: r.original_title ?? r.title ?? '', year: yearOf(r.release_date), overview: r.overview ?? '', popularity: r.popularity ?? 0 };
  }
  if (type === 'tv') {
    return { tmdbId: r.id, kind: 'series', title: r.name ?? '', originalTitle: r.original_name ?? r.name ?? '', year: yearOf(r.first_air_date), overview: r.overview ?? '', popularity: r.popularity ?? 0 };
  }
  return undefined;
}

/**
 * Merge candidates from several responses (es-ES, en-US, ...) by kind+id. The first title seen (es-ES) is kept as the
 * display title; every title seen goes into `names` for scoring.
 */
export function mergeCandidates(list) {
  const map = new Map();
  for (const c of list) {
    if (!c) continue;
    const key = `${c.kind}:${c.tmdbId}`;
    const prev = map.get(key);
    if (!prev) map.set(key, { ...c, names: new Set([c.title, c.originalTitle]) });
    else {
      prev.names.add(c.title);
      prev.names.add(c.originalTitle);
      if (!prev.overview && c.overview) prev.overview = c.overview;
      prev.popularity = Math.max(prev.popularity, c.popularity);
      prev.year ??= c.year;
    }
  }
  return [...map.values()].map((c) => ({ ...c, names: [...c.names].filter(Boolean) }));
}

/**
 * Score one candidate for a parsed entry (D4): best title similarity over every name, plus a year boost
 * (+0.1 exact, +0.05 off by one, -0.05 further), a kind hint (+0.05 / -0.1) and a popularity tie-break (<= 0.02).
 */
export function scoreCandidate(entry, c) {
  let s = Math.max(0, ...c.names.map((n) => similarity(entry.title, n)));
  if (entry.year && c.year) {
    const d = Math.abs(entry.year - c.year);
    s += d === 0 ? 0.1 : d === 1 ? 0.05 : -0.05;
  }
  if (entry.kind) s += entry.kind === c.kind ? 0.05 : -0.1;
  s += Math.min(0.02, Math.log10(1 + c.popularity) / 200);
  return s;
}

/** Rank candidates best first, with `score`, and decide whether the top one is confident. */
export function rank(entry, candidates) {
  const ranked = candidates.map((c) => ({ ...c, score: Number(scoreCandidate(entry, c).toFixed(4)) })).sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  const confident = !!top && top.score >= CONFIDENT_SCORE && (!second || top.score - second.score >= CONFIDENT_LEAD);
  return { ranked, confident };
}
