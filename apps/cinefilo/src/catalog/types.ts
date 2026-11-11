export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type TmdbKind = 'movie' | 'series';

/** One search hit, already mapped to cinefilo's vocabulary. `posterPath` is TMDB's path (e.g. "/abc.jpg"). */
export interface TmdbResult {
  tmdbId: number;
  mediaKind: TmdbKind;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
}

/** What a details lookup adds. */
export interface TmdbDetails {
  tmdbId: number;
  mediaKind: TmdbKind;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  genres: string[];
  runtimeMin: number | null;
  seasonCount: number | null;
}

/** Why a request failed. Carries no URL, header or key. */
export type TmdbFailure =
  | { kind: 'no-key' }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'unauthorized' }
  | { kind: 'rate-limited' }
  | { kind: 'not-found' }
  | { kind: 'http'; status: number }
  | { kind: 'bad-response' };

export type TmdbOutcome<T> = { kind: 'ok'; value: T } | TmdbFailure;
