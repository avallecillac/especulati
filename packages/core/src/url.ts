import { err, ok, type Result } from './result.ts';
import type { Brand, ParseError } from './types.ts';

/** An http(s) address in the canonical form `normalizeUrl` produces (005 R6). */
export type NormalizedUrl = Brand<string, 'NormalizedUrl'>;

const bad = (reason: string) => err<ParseError>({ field: 'url', reason });

const URL_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/;
const HOST_RE = /^[a-z0-9_](?:[a-z0-9_.-]*[a-z0-9_])?$/;
const DEFAULT_PORT = { http: '80', https: '443' } as const;
const TRACKING = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'igshid', 'si']);

const isTracking = (name: string): boolean => {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || TRACKING.has(n);
};

/**
 * A small hand-written parser: core's lib has no `URL`. Only http/https; no userinfo and no IPv6
 * hosts. The scheme and host are lowercased, a default port and the #fragment are dropped, tracking
 * parameters are removed (the rest keep their order), and an empty path becomes "/".
 */
export function normalizeUrl(input: string): Result<NormalizedUrl, ParseError> {
  const s = input.trim();
  if (/\s/.test(s)) return bad('contains whitespace');
  const m = URL_RE.exec(s);
  if (!m) return bad('not a URL');
  const scheme = m[1]!.toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return bad('only http and https are supported');
  const authority = m[2]!;
  if (authority.includes('@')) return bad('user info is not supported');
  const portAt = authority.lastIndexOf(':');
  const host = (portAt === -1 ? authority : authority.slice(0, portAt)).toLowerCase();
  const port = portAt === -1 ? '' : authority.slice(portAt + 1);
  if (!HOST_RE.test(host)) return bad('bad host');
  if (port !== '' && !/^\d{1,5}$/.test(port)) return bad('bad port');
  const keepPort = port !== '' && port !== DEFAULT_PORT[scheme];
  const path = m[3]! === '' ? '/' : m[3]!;
  const params = (m[4] ?? '').split('&').filter((p) => p !== '' && !isTracking(p.split('=', 1)[0]!));
  return ok(`${scheme}://${host}${keepPort ? `:${port}` : ''}${path}${params.length > 0 ? `?${params.join('&')}` : ''}` as NormalizedUrl);
}

/** The host without a leading `www.` (data-model: `domain`). */
export function siteOf(url: NormalizedUrl): string {
  const host = /^https?:\/\/([^/:?#]*)/.exec(url)![1]!;
  return host.startsWith('www.') ? host.slice(4) : host;
}
