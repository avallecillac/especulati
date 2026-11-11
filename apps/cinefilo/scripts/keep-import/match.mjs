import { similarity } from './normalize.mjs';
import { mergeCandidates, rank, toCandidate } from './score.mjs';

const LANGS = ['es-ES', 'en-US'];
const COLLECTION_WORDS = /\b(collection|coleccion|colección|saga|trilogy|trilogia|trilogía|serie|films?|películas|peliculas)\b/gi;
const MIN_COLLECTION_SIM = 0.8;
const cleanCollectionName = (n) => n.replace(COLLECTION_WORDS, ' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
const byRelease = (a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999') || a.id - b.id;

async function searchCandidates(tmdb, entry) {
  const found = [];
  for (const language of LANGS) {
    const q = { query: entry.title, language, include_adult: false, page: 1 };
    const multi = await tmdb.get('search/multi', q);
    found.push(...(multi.results ?? []).map((r) => toCandidate(r)));
    if (entry.kind) {
      const type = entry.kind === 'series' ? 'tv' : 'movie';
      const typed = await tmdb.get(`search/${type}`, q);
      found.push(...(typed.results ?? []).map((r) => toCandidate(r, type)));
    }
  }
  return mergeCandidates(found);
}

/** Parts of the collection called `base` (ordered by release), or undefined when no collection looks like it. */
async function findCollection(tmdb, base) {
  const search = await tmdb.get('search/collection', { query: base, language: LANGS[0], page: 1 });
  const best = (search.results ?? [])
    .map((r) => ({ r, s: similarity(base, cleanCollectionName(r.name ?? '')) }))
    .sort((a, b) => b.s - a.s)[0];
  if (!best || best.s < MIN_COLLECTION_SIM) return undefined;
  const col = await tmdb.get(`collection/${best.r.id}`, { language: LANGS[0] });
  const parts = [...(col.parts ?? [])].sort(byRelease);
  return parts.length ? parts : undefined;
}

const partCandidate = (p) => toCandidate({ ...p, media_type: 'movie' });
const base = (e) => ({ id: e.id, line: e.line, list: e.list, title: e.title, ...(e.year ? { year: e.year } : {}), ...(e.kind ? { kind: e.kind } : {}), ...(e.hint ? { hint: e.hint } : {}) });

/**
 * Match parsed entries on TMDB. Per entry: `{ id, line, list, title, status: 'confident' | 'uncertain', chosen?, candidates, via? }`.
 *  - `multi` parts ("Base 1, 2, 3") take the Nth film of the collection (ordered by release date);
 *  - `expand: 'collection'` ("(trilogy)") becomes one result per collection part (ids `line.n`);
 *  - anything the collection step cannot resolve falls back to the normal scored search.
 */
export async function matchEntries(entries, tmdb) {
  const out = [];
  const collections = new Map();
  const collection = (name) => {
    if (!collections.has(name)) collections.set(name, findCollection(tmdb, name));
    return collections.get(name);
  };
  for (const e of entries) {
    if (e.multi || e.expand) {
      const parts = await collection(e.multi?.base ?? e.title);
      if (e.multi && parts?.[e.multi.number - 1]) {
        const chosen = { ...partCandidate(parts[e.multi.number - 1]), score: 1 };
        out.push({ ...base(e), status: 'confident', via: 'collection', chosen, candidates: [chosen] });
        continue;
      }
      if (e.expand && parts) {
        parts.forEach((p, i) => {
          const chosen = { ...partCandidate(p), score: 1 };
          out.push({ ...base(e), id: `${e.id}.${i + 1}`, title: p.title, status: 'confident', via: 'collection', chosen, candidates: [chosen] });
        });
        continue;
      }
    }
    const { ranked, confident } = rank(e, await searchCandidates(tmdb, e));
    out.push({ ...base(e), status: confident ? 'confident' : 'uncertain', ...(confident ? { chosen: ranked[0] } : {}), candidates: ranked.slice(0, 5) });
  }
  return out;
}
