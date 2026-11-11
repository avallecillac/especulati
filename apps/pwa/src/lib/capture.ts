import { normalizeNote, normalizeQuote, normalizeUrl, parseWordCount, siteOf } from '@readerlog/core';
import { CAPTURE_ID_LABEL, HIGHLIGHT_ID_LABEL } from './frozen.ts';
import { uuidFromHash } from './ids.ts';

/** A capture link's payload, validated (contracts/capture.md). */
export interface Capture {
  /** Normalized address. */
  url: string;
  site: string;
  title: string;
  author: string | null;
  /** null = "couldn't count" (missing, 0, or out of range). */
  wordCount: number | null;
  /** The capture instant as a UTC ISO string: the idempotency key with the address (research R5). */
  at: string;
  /** The highlighted passage (007), normalized; null = an article capture (005). */
  quote: string | null;
  /** Only ever set together with `quote`. */
  note: string | null;
  /** Save for later (008). Always false when `quote` is set: a highlight wins. */
  later: boolean;
  /** Raw tag names from the link (008): at most 20 strings; the worker normalises them. */
  tags: string[];
}

/** Which part of the payload is wrong: shown on the damaged-link screen. */
export type CaptureProblem = 'encoding' | 'v' | 'url' | 'at' | 'quote';

export interface CaptureError {
  reason: CaptureProblem;
}

const fail = (reason: CaptureProblem) => ({ ok: false as const, error: { reason } });

const TITLE_MAX = 500;
const AUTHOR_MAX = 200;
const TAGS_MAX = 20;

/** Standard Base64 (any line breaks) or base64url, to text. Throws on bad input. */
function decodeBase64(d: string): string {
  const b64 = d.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(b64) || b64.length % 4 === 1) throw new Error('bad base64');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const cut = (s: string, max: number): string => [...s].slice(0, max).join('');

/**
 * Decode the `d` value of `#/capture?d=…`: the raw text after `d=`, still URL-encoded or not.
 * A raw space is a `+` that lost its encoding on the way; other whitespace is a line break.
 */
export function decodeCapture(d: string) {
  let text: string;
  try {
    const raw = /%[0-9A-Fa-f]{2}/.test(d) ? decodeURIComponent(d) : d;
    text = decodeBase64(raw.replace(/ /g, '+'));
  } catch {
    return fail('encoding');
  }
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return fail('encoding');
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return fail('encoding');
  const p = o as Record<string, unknown>;
  if (p['v'] !== 1) return fail('v');
  if (typeof p['url'] !== 'string') return fail('url');
  const url = normalizeUrl(p['url']);
  if (!url.ok) return fail('url');
  const at = typeof p['at'] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p['at']) ? Date.parse(p['at']) : NaN;
  if (Number.isNaN(at)) return fail('at');

  const site = siteOf(url.value);
  const title = typeof p['title'] === 'string' ? cut(p['title'].trim(), TITLE_MAX).trim() : '';
  const author = typeof p['author'] === 'string' ? cut(p['author'].trim(), AUTHOR_MAX).trim() : '';
  const rawWords = typeof p['words'] === 'string' && /^\s*\d+\s*$/.test(p['words']) ? Number(p['words']) : p['words'];
  const words = typeof rawWords === 'number' ? parseWordCount(rawWords) : null;

  // A quote over the limit saves nothing, not even the article (contracts/capture-highlight.md).
  const q = normalizeQuote(typeof p['quote'] === 'string' ? p['quote'] : '');
  if (!q.ok) return fail('quote');
  // A note that is too long is dropped: the passage is the point, and it is added by hand later.
  const n = q.value !== null && typeof p['note'] === 'string' ? normalizeNote(p['note']) : null;

  const later = q.value === null && (p['later'] === 1 || p['later'] === true || p['later'] === '1');
  const tags = Array.isArray(p['tags']) ? p['tags'].filter((t): t is string => typeof t === 'string').slice(0, TAGS_MAX) : [];

  const value: Capture = {
    url: url.value,
    site,
    title: title === '' ? site : title,
    author: author === '' ? null : author,
    wordCount: words !== null && words.ok && words.value > 0 ? words.value : null,
    at: new Date(at).toISOString(),
    quote: q.value,
    note: n !== null && n.ok ? n.value : null,
    later,
    tags,
  };
  return { ok: true as const, value };
}

/** The derived article id: the same link opened twice gives the same id (research R5). */
export const captureId = (c: Pick<Capture, 'url' | 'at'>): Promise<string> =>
  uuidFromHash(`${CAPTURE_ID_LABEL}|${c.url}|${c.at}`);

/** The derived highlight id: the same link opened twice gives "Already saved" (research 007 R6). */
export const highlightCaptureId = (url: string, at: string): Promise<string> =>
  uuidFromHash(`${HIGHLIGHT_ID_LABEL}|${url}|${at}`);

/** The derived id of a saved article: the 005 label plus `|later` (contracts/capture-008.md). */
export const saveCaptureId = (c: Pick<Capture, 'url' | 'at'>): Promise<string> =>
  uuidFromHash(`${CAPTURE_ID_LABEL}|${c.url}|${c.at}|later`);
