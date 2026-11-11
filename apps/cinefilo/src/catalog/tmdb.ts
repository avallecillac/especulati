// The TMDB client (design D8): runs in the shell with `fetch`. Maps TMDB's JSON to cinefilo's vocabulary.
import { tmdbGet, TMDB_IMAGE } from './request.ts';
import type { Fetch, TmdbDetails, TmdbFailure, TmdbKind, TmdbOutcome, TmdbResult } from './types.ts';

export { isV4Token, TMDB_IMAGE } from './request.ts';
export type * from './types.ts';

interface Deps {
  fetch: Fetch;
  timeoutMs?: number;
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const yearOf = (v: unknown): number | null => {
  const m = typeof v === 'string' ? /^(\d{4})/.exec(v) : null;
  return m ? Number(m[1]) : null;
};
const mediaKindOf = (t: unknown): TmdbKind | null => (t === 'movie' ? 'movie' : t === 'tv' ? 'series' : null);

/** The poster URL the shell/worker downloads (width 342). */
export const posterUrl = (path: string): string => `${TMDB_IMAGE}${path}`;

/** The small poster (width 92) the add sheet shows in search results. It loads straight from TMDB's image host and never carries the key. */
export const thumbUrl = (path: string): string => `https://image.tmdb.org/t/p/w92${path}`;

function mapResult(raw: unknown, forced?: TmdbKind): TmdbResult | null {
  const o = obj(raw);
  if (!o) return null;
  const mediaKind = forced ?? mediaKindOf(o['media_type']);
  const tmdbId = posInt(o['id']);
  if (!mediaKind || !tmdbId) return null;
  const title = str(mediaKind === 'movie' ? o['title'] : o['name']);
  if (!title) return null;
  const original = str(mediaKind === 'movie' ? o['original_title'] : o['original_name']);
  return {
    tmdbId,
    mediaKind,
    title,
    originalTitle: original && original !== title ? original : null,
    year: yearOf(mediaKind === 'movie' ? o['release_date'] : o['first_air_date']),
    posterPath: str(o['poster_path']),
    overview: str(o['overview']),
  };
}

/** `search/multi`: movie and tv hits only (people are dropped), optionally narrowed to one kind. */
export async function searchTmdb(query: string, key: string | null, deps: Deps, kind?: TmdbKind): Promise<TmdbOutcome<TmdbResult[]>> {
  if (!key) return { kind: 'no-key' };
  const q = query.trim();
  if (q === '') return { kind: 'ok', value: [] };
  const r = await tmdbGet('search/multi', { query: q, include_adult: 'false', language: 'en-US', page: '1' }, key, deps);
  if (r.kind !== 'ok') return r;
  const results = obj(r.json)?.['results'];
  if (!Array.isArray(results)) return { kind: 'bad-response' };
  const mapped = results.map((x) => mapResult(x)).filter((x): x is TmdbResult => x !== null);
  return { kind: 'ok', value: kind ? mapped.filter((x) => x.mediaKind === kind) : mapped };
}

/** `movie/{id}` or `tv/{id}`: adds genres, runtime (movies) and season count (series). */
export async function tmdbDetails(kind: TmdbKind, tmdbId: number, key: string | null, deps: Deps): Promise<TmdbOutcome<TmdbDetails>> {
  if (!key) return { kind: 'no-key' };
  const r = await tmdbGet(`${kind === 'movie' ? 'movie' : 'tv'}/${tmdbId}`, { language: 'en-US' }, key, deps);
  if (r.kind !== 'ok') return r;
  const o = obj(r.json);
  const base = o ? mapResult({ ...o, id: o['id'] ?? tmdbId }, kind) : null;
  if (!o || !base) return { kind: 'bad-response' };
  const genres = Array.isArray(o['genres']) ? o['genres'].map((g) => str(obj(g)?.['name'])).filter((g): g is string => g !== null) : [];
  return {
    kind: 'ok',
    value: {
      tmdbId: base.tmdbId,
      mediaKind: kind,
      title: base.title,
      originalTitle: base.originalTitle,
      year: base.year,
      posterPath: base.posterPath,
      genres,
      runtimeMin: kind === 'movie' ? posInt(o['runtime']) : null,
      seasonCount: kind === 'series' ? posInt(o['number_of_seasons']) : null,
    },
  };
}

/** Plain-language text for a failure; never includes the key or the request URL. */
export function failureText(f: Exclude<TmdbFailure, { kind: 'no-key' }>): string {
  switch (f.kind) {
    case 'timeout':
      return 'TMDB took too long to answer.';
    case 'network':
      return 'Could not reach TMDB.';
    case 'unauthorized':
      return 'TMDB did not accept your key. Check it in Settings.';
    case 'rate-limited':
      return 'TMDB is busy. Try again in a moment.';
    default:
      return 'TMDB could not answer right now.';
  }
}
