import {
  parseRemoteOpWith, err, type FieldValue, type OpWire, type ParseError, type RemoteOp as SyncRemoteOp, type Result, type SyncSchema,
} from '@especulati/sync-core';
import type { Table } from './commands.ts';
import { genresFromDb } from './rows.ts';
import { ANSWERS, isUuid, KINDS, MEMBER_STATUSES, REVIEW_MAX, STATUSES, VERDICTS } from './types.ts';

/**
 * Columns a Change (local or remote) may set, per table. Guards against building SQL from untrusted
 * field names. `id` is never writable: the row id travels separately. Local-only data (posters, meta)
 * has no table here, so it can never arrive over sync.
 */
export const WRITABLE_FIELDS: Readonly<Record<Table, ReadonlySet<string>>> = {
  titles: new Set([
    'kind', 'title', 'original_title', 'year', 'tmdb_id', 'poster_url', 'genres', 'runtime_min', 'season_count', 'status',
    'watched_on', 'current_season', 'watch_order', 'merged_into', 'added_by', 'created_at', 'deleted_at',
  ]),
  members: new Set(['name', 'created_at', 'deleted_at']),
  ratings: new Set(['title_id', 'member_id', 'verdict', 'review', 'updated_at', 'deleted_at']),
  member_status: new Set(['title_id', 'member_id', 'status', 'watched_on', 'current_season', 'updated_at', 'deleted_at']),
  recommendations: new Set(['title_id', 'from_member', 'to_member', 'created_at', 'withdrawn_at', 'answered', 'answered_at', 'deleted_at']),
};

/** Fields an op must carry to create a row that does not exist yet (else it is parked). */
export const INSERT_FIELDS: Readonly<Record<Table, readonly string[]>> = {
  titles: ['kind', 'title', 'status', 'added_by', 'created_at'],
  members: ['name', 'created_at'],
  ratings: ['title_id', 'member_id', 'updated_at'],
  member_status: ['title_id', 'member_id', 'updated_at'],
  recommendations: ['title_id', 'from_member', 'to_member', 'created_at'],
};

/**
 * Batch tier (personal-lists D4): a pushed batch never mixes tiers, so a device on an older version skips only the
 * batches it cannot read. `p` is the personal-lists tier: `member_status`, `recommendations`, and any `titles` op that
 * writes `status: null` (a title that is not on Together; the old schema refuses NULL). The key must be present with
 * a null value, so an insert without a Together status names `status` explicitly. Everything else is `base`.
 */
export function tierOf(tbl: Table, fields: Readonly<Record<string, FieldValue>>): 'base' | 'p' {
  if (tbl === 'member_status' || tbl === 'recommendations') return 'p';
  if (tbl === 'titles' && Object.prototype.hasOwnProperty.call(fields, 'status') && fields['status'] === null) return 'p';
  // cinefilo-feedback-1 D3: an older version's allow-list refuses `watch_order`, so any op that writes it is tier `p` too.
  if (tbl === 'titles' && Object.prototype.hasOwnProperty.call(fields, 'watch_order')) return 'p';
  return 'base';
}

export const cinefiloSchema: SyncSchema<Table> = { writable: WRITABLE_FIELDS, insertRequired: INSERT_FIELDS, tierOf };

export type RemoteOp = SyncRemoteOp<Table>;

/** Reference columns: null or a lowercase uuid. */
const REF_FIELDS: Readonly<Record<Table, readonly string[]>> = {
  titles: ['added_by', 'merged_into'],
  members: [],
  ratings: ['title_id', 'member_id'],
  member_status: ['title_id', 'member_id'],
  recommendations: ['title_id', 'from_member', 'to_member'],
};
// `titles.status` is nullable since personal lists (a title can be in the catalog without being on Together).
const NOT_NULL: Readonly<Record<Table, readonly string[]>> = {
  titles: ['kind', 'title', 'added_by', 'created_at'],
  members: ['name', 'created_at'],
  ratings: ['title_id', 'member_id', 'updated_at'],
  member_status: ['title_id', 'member_id', 'updated_at'],
  recommendations: ['title_id', 'from_member', 'to_member', 'created_at'],
};

const bad = (field: string, reason: string) => err<ParseError>({ field, reason });
const inEnum = (all: readonly string[], v: FieldValue) => typeof v === 'string' && all.includes(v);

/** Values the DB's CHECK constraints would refuse; one such op must not roll back a whole batch. */
function checkValues(tbl: Table, f: Readonly<Record<string, FieldValue>>): ParseError | null {
  for (const k of NOT_NULL[tbl]) if (k in f && f[k] === null) return { field: k, reason: 'must not be null' };
  for (const k of REF_FIELDS[tbl]) if (k in f && f[k] !== null && !isUuid(f[k])) return { field: k, reason: 'not a lowercase uuid' };
  if (tbl === 'titles') {
    if ('kind' in f && !inEnum(KINDS, f['kind'])) return { field: 'kind', reason: 'unknown kind' };
    if ('status' in f && f['status'] !== null && !inEnum(STATUSES, f['status'])) return { field: 'status', reason: 'unknown status' };
    const wo = f['watch_order'];
    if (wo !== undefined && wo !== null && !(typeof wo === 'number' && Number.isInteger(wo) && wo >= 1)) return { field: 'watch_order', reason: 'not a positive whole number' };
    const g = f['genres'];
    if (g !== undefined && g !== null && (typeof g !== 'string' || genresFromDb(g) === null)) return { field: 'genres', reason: 'not a JSON array of strings' };
  }
  if (tbl === 'ratings') {
    const v = f['verdict'];
    if (v !== undefined && v !== null && !inEnum(VERDICTS, v)) return { field: 'verdict', reason: 'unknown verdict' };
    const r = f['review'];
    if (r !== undefined && r !== null && (typeof r !== 'string' || [...r].length > REVIEW_MAX)) return { field: 'review', reason: 'not a review of at most 1,000 characters' };
  }
  if (tbl === 'member_status') {
    const s = f['status'];
    if (s !== undefined && s !== null && !inEnum(MEMBER_STATUSES, s)) return { field: 'status', reason: 'unknown status' };
  }
  if (tbl === 'recommendations') {
    const a = f['answered'];
    if (a !== undefined && a !== null && !inEnum(ANSWERS, a)) return { field: 'answered', reason: 'unknown answer' };
  }
  return null;
}

const parseStructure = parseRemoteOpWith(cinefiloSchema);

/**
 * Validate untrusted wire data: known table, allow-listed fields, well-formed ids and HLC, and values
 * that satisfy the schema's checks. The op's device is the one named in its HLC (see sync-core).
 */
export function parseRemoteOp(w: OpWire, device: string): Result<RemoteOp, ParseError> {
  const r = parseStructure(w, device);
  if (!r.ok) return r;
  const problem = checkValues(r.value.tbl, r.value.fields);
  return problem ? bad(problem.field, problem.reason) : r;
}
