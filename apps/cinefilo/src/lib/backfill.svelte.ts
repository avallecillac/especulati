import { posterObjectUrl } from './posters.ts';
import { needsDetails } from './dbClient.ts';
import { covers } from './covers.svelte.ts';
import { details, tmdb } from './tmdb.svelte.ts';
import { write } from './state.svelte.ts';

/** One TMDB request every 2 s at most, so a 250-title import never hammers the API (import-keep-lists D3). */
export const BACKFILL_INTERVAL_MS = 2000;

/** Titles tried since the page loaded: a title TMDB cannot fill is not retried until a reload or reconnect. */
const attempted = new Set<string>();
let running = false;
let lastRequestAt = 0;

window.addEventListener('online', () => attempted.clear());

/** Wait until the spacing since the previous request has passed. */
async function pace(): Promise<void> {
  const wait = lastRequestAt + BACKFILL_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/**
 * Fill the details (and cache the poster) of imported titles that have a TMDB id and nothing else, one by one.
 * Uses the same `LinkToTmdb` and poster paths as linking by hand. Only with a key and a connection; resumable
 * because what is left to do is read from the database each time; never awaited by the UI.
 */
export async function runBackfill(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (tmdb.key !== null && tmdb.online) {
      const todo = await needsDetails(50);
      if (!todo.ok) return;
      const next = todo.value.find((x) => !attempted.has(x.id));
      if (!next) return;
      attempted.add(next.id);
      await pace();
      const d = await details(next.kind, next.tmdbId);
      if (d.kind === 'unauthorized' || d.kind === 'rate-limited' || d.kind === 'no-key') return;
      if (d.kind !== 'ok') continue;
      const info = d.value;
      const r = await write({
        kind: 'LinkToTmdb',
        titleId: next.id,
        tmdbId: next.tmdbId,
        details: {
          ...(info.originalTitle ? { originalTitle: info.originalTitle } : {}),
          ...(info.year ? { year: info.year } : {}),
          ...(info.posterPath ? { posterUrl: info.posterPath } : {}),
          ...(info.genres.length > 0 ? { genres: info.genres } : {}),
          ...(info.runtimeMin ? { runtimeMin: info.runtimeMin } : {}),
          ...(info.seasonCount ? { seasonCount: info.seasonCount } : {}),
        },
      });
      if (r.ok && info.posterPath && covers.mode === 'posters') {
        await pace();
        await posterObjectUrl(next.id, info.posterPath);
      }
    }
  } finally {
    running = false;
  }
}
