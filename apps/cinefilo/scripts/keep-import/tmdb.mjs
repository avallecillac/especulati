import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://api.themoviedb.org/3/';

/** Minimal `.env` reader: KEY=VALUE lines, optional quotes, `#` comments. */
export function parseEnv(text) {
  const out = {};
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || l.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export async function readApiKey(envPath) {
  const text = await readFile(envPath, 'utf8').catch(() => '');
  return parseEnv(text).TMDB_API_KEY || undefined;
}

/** A v4 read token is a JWT (three dot-separated parts); a v3 key is 32 hex chars. */
export const isV4Token = (key) => key.split('.').length === 3;

/**
 * TMDB client: throttled (default 250 ms between live calls = 4/s), cached by URL (without the key) in `cacheDir`.
 * The key goes only into the live request (v3 `api_key` param, v4 Bearer header); never into cache keys, files or errors.
 * Options: `fetchFn`, `apiKey`, `cacheDir`, `minIntervalMs`, `sleep`, `now` (injectable for tests).
 */
export function createTmdb({ fetchFn = fetch, apiKey, cacheDir, minIntervalMs = 250, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  let last = -Infinity;
  const stats = { live: 0, cached: 0 };

  async function get(endpoint, params = {}) {
    const url = new URL(endpoint, BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const publicUrl = url.toString();
    const file = cacheDir ? path.join(cacheDir, `${createHash('sha1').update(publicUrl).digest('hex')}.json`) : undefined;
    if (file) {
      const hit = await readFile(file, 'utf8').catch(() => undefined);
      if (hit !== undefined) {
        stats.cached++;
        return JSON.parse(hit);
      }
    }
    if (!apiKey) throw new Error(`TMDB_API_KEY is not set (add it to .env); no cached response for ${publicUrl}`);
    const wait = last + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
    const headers = { accept: 'application/json' };
    if (isV4Token(apiKey)) headers.authorization = `Bearer ${apiKey}`;
    else url.searchParams.set('api_key', apiKey);
    stats.live++;
    let res;
    try {
      res = await fetchFn(url.toString(), { headers });
    } catch {
      throw new Error(`TMDB request failed: ${publicUrl}`);
    }
    if (!res.ok) throw new Error(`TMDB ${res.status} for ${publicUrl}`);
    const body = await res.json();
    if (file) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify(body));
    }
    return body;
  }

  return { get, stats };
}
