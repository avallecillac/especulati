import { err, ok, type ParseError, type Result } from '@especulati/sync-core';
import { manualTitleLabel, tmdbTitleLabel } from './titleKey.ts';
import { fail, parseKind, parseStatus, parseTitle, type Kind, type Status } from './types.ts';

/** The `cinefilo-titles/v1` list a member imports (import-keep-lists D2). A list of titles, not a backup: see `cinefilo/v1`. */
export const TITLES_FORMAT = 'cinefilo-titles/v1';

/** Statuses an imported entry may have (no `dropped`). */
export type ImportStatus = Extract<Status, 'later' | 'watching' | 'watched'>;

export interface TitleEntry {
  readonly kind: Kind;
  readonly title: string;
  readonly year: number | null;
  readonly tmdbId: number | null;
  readonly status: ImportStatus;
  /** Place in the shared watch history (D4): a positive whole number, unique in the file, only for watched. */
  readonly watchOrder: number | null;
}

export interface TitlesFile {
  readonly format: typeof TITLES_FORMAT;
  readonly titles: readonly TitleEntry[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ENTRY_KEYS = new Set(['kind', 'title', 'year', 'tmdbId', 'status', 'watchOrder']);

function optInt(field: string, v: unknown, min: number, max: number): Result<number | null, ParseError> {
  if (v === undefined || v === null) return ok(null);
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? ok(v) : fail(field, `must be a whole number from ${min} to ${max}`);
}

function parseEntry(i: number, o: unknown): Result<TitleEntry, ParseError> {
  const at = (f: string) => `titles[${i}].${f}`;
  if (!isObj(o)) return fail(`titles[${i}]`, 'must be an object');
  for (const k of Object.keys(o)) if (!ENTRY_KEYS.has(k)) return fail(at(k), 'unknown field');
  if (typeof o['kind'] !== 'string') return fail(at('kind'), 'must be a string');
  const kind = parseKind(o['kind']);
  if (!kind.ok) return fail(at('kind'), kind.error.reason);
  if (typeof o['title'] !== 'string') return fail(at('title'), 'must be a string');
  const title = parseTitle(o['title']);
  if (!title.ok) return fail(at('title'), title.error.reason);
  if (typeof o['status'] !== 'string') return fail(at('status'), 'must be a string');
  const status = parseStatus(o['status']);
  if (!status.ok) return fail(at('status'), status.error.reason);
  if (status.value === 'dropped') return fail(at('status'), 'must be one of later, watching, watched');
  if (status.value === 'watching' && kind.value !== 'series') return fail(at('status'), 'watching is only for series');
  const year = optInt(at('year'), o['year'], 1850, 2200);
  if (!year.ok) return year;
  const tmdbId = optInt(at('tmdbId'), o['tmdbId'], 1, 2_000_000_000);
  if (!tmdbId.ok) return tmdbId;
  const watchOrder = optInt(at('watchOrder'), o['watchOrder'], 1, 2_000_000_000);
  if (!watchOrder.ok) return watchOrder;
  if (watchOrder.value !== null && status.value !== 'watched') return fail(at('watchOrder'), 'only for watched titles');
  return ok({ kind: kind.value, title: title.value, year: year.value, tmdbId: tmdbId.value, status: status.value, watchOrder: watchOrder.value });
}

/** The label that decides whether two entries are the same title (the same one the shell hashes into an id). */
export const entryLabel = (e: TitleEntry): string =>
  e.tmdbId !== null ? tmdbTitleLabel(e.kind, e.tmdbId) : manualTitleLabel(e.kind, e.title, e.year);

/** Parse and fully validate a file's text; any problem rejects the whole file. Pure: no I/O. */
export function parseTitlesFile(text: string): Result<TitlesFile, ParseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('file', 'not JSON');
  }
  if (!isObj(raw)) return fail('file', 'not an object');
  if (raw['format'] !== TITLES_FORMAT) return fail('format', 'unsupported version');
  const list = raw['titles'];
  if (!Array.isArray(list)) return fail('titles', 'must be a list');
  const titles: TitleEntry[] = [];
  const seen = new Map<string, number>();
  const orders = new Map<number, number>();
  for (let i = 0; i < list.length; i++) {
    const r = parseEntry(i, list[i]);
    if (!r.ok) return err(r.error);
    const label = entryLabel(r.value);
    const first = seen.get(label);
    if (first !== undefined) return fail(`titles[${i}]`, `duplicate of titles[${first}]`);
    seen.set(label, i);
    const wo = r.value.watchOrder;
    if (wo !== null) {
      const dup = orders.get(wo);
      if (dup !== undefined) return fail(`titles[${i}].watchOrder`, `duplicate of titles[${dup}]`);
      orders.set(wo, i);
    }
    titles.push(r.value);
  }
  return ok({ format: TITLES_FORMAT, titles });
}
