import { searchTmdb, tmdbDetails, type TmdbDetails, type TmdbKind, type TmdbOutcome, type TmdbResult } from '../catalog/tmdb.ts';
import { tmdbKeyGet, tmdbKeySet } from './dbClient.ts';

/** The TMDB key (device-local) and whether the browser thinks it is online. The key is only ever held here and in `meta`. */
export const tmdb = $state<{ key: string | null; online: boolean }>({ key: null, online: navigator.onLine });

window.addEventListener('online', () => (tmdb.online = true));
window.addEventListener('offline', () => (tmdb.online = false));

const deps = { fetch: (u: string, i?: RequestInit) => fetch(u, i) };

export async function loadTmdbKey(): Promise<void> {
  const r = await tmdbKeyGet();
  if (r.ok) tmdb.key = r.value;
}

export async function saveTmdbKey(key: string): Promise<boolean> {
  const r = await tmdbKeySet(key.trim());
  if (r.ok) tmdb.key = r.value;
  return r.ok;
}

/** Search is offered only with a key and a connection. */
export const searchAvailable = (): boolean => tmdb.key !== null && tmdb.online;

export const search = (q: string, kind: TmdbKind): Promise<TmdbOutcome<TmdbResult[]>> => searchTmdb(q, tmdb.key, deps, kind);
export const details = (kind: TmdbKind, id: number): Promise<TmdbOutcome<TmdbDetails>> => tmdbDetails(kind, id, tmdb.key, deps);
