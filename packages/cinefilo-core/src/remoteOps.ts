import {
  parseRemoteOpWith, err, type FieldValue, type OpWire, type ParseError, type RemoteOp as SyncRemoteOp, type Result, type SyncSchema,
} from '@especulati/sync-core';
import type { Table } from './commands.ts';
import { genresFromDb } from './rows.ts';
import { isUuid, KINDS, REVIEW_MAX, STATUSES, VERDICTS } from './types.ts';

/**
 * Columns a Change (local or remote) may set, per table. Guards against building SQL from untrusted
 * field names. `id` is never writable: the row id travels separately. Local-only data (posters, meta)
 * has no table here, so it can never arrive over sync.
 */
export const WRITABLE_FIELDS: Readonly<Record<Table, ReadonlySet<string>>> = {
  titles: new Set([
    'kind', 'title', 'original_title', 'year', 'tmdb_id', 'poster_url', 'genres', 'runtime_min', 'season_count', 'status',
    'watched_on', 'current_season', 'merged_into', 'added_by', 'created_at', 'deleted_at',
  ]),
  members: new Set(['name', 'created_at', 'deleted_at']),
  ratings: new Set(['title_id', 'member_id', 'verdict', 'review', 'updated_at', 'deleted_at']),
};

/** Fields an op must carry to create a row that does not exist yet (else it is parked). */
export const INSERT_FIELDS: Readonly<Record<Table, readonly string[]>> = {
  titles: ['kind', 'title', 'status', 'added_by', 'created_at'],
  members: ['name', 'created_at'],
  ratings: ['title_id', 'member_id', 'updated_at'],
};

/** Schema v1 has one tier for every table; a future table gets its own tier here (D9). */
export const tierOf = (_tbl: Table, _fields: Readonly<Record<string, FieldValue>>): 'base' => 'base';

export const cinefiloSchema: SyncSchema<Table> = { writable: WRITABLE_FIELDS, insertRequired: INSERT_FIELDS, tierOf };

export type RemoteOp = SyncRemoteOp<Table>;

/** Reference columns: null or a lowercase uuid. */
const REF_FIELDS: Readonly<Record<Table, readonly string[]>> = {
  titles: ['added_by', 'merged_into'],
  members: [],
  ratings: ['title_id', 'member_id'],
};
const NOT_NULL: Readonly<Record<Table, readonly string[]>> = {
  titles: ['kind', 'title', 'status', 'added_by', 'created_at'],
  members: ['name', 'created_at'],
  ratings: ['title_id', 'member_id', 'updated_at'],
};

const bad = (field: string, reason: string) => err<ParseError>({ field, reason });
const inEnum = (all: readonly string[], v: FieldValue) => typeof v === 'string' && all.includes(v);

/** Values the DB's CHECK constraints would refuse; one such op must not roll back a whole batch. */
function checkValues(tbl: Table, f: Readonly<Record<string, FieldValue>>): ParseError | null {
  for (const k of NOT_NULL[tbl]) if (k in f && f[k] === null) return { field: k, reason: 'must not be null' };
  for (const k of REF_FIELDS[tbl]) if (k in f && f[k] !== null && !isUuid(f[k])) return { field: k, reason: 'not a lowercase uuid' };
  if (tbl === 'titles') {
    if ('kind' in f && !inEnum(KINDS, f['kind'])) return { field: 'kind', reason: 'unknown kind' };
    if ('status' in f && !inEnum(STATUSES, f['status'])) return { field: 'status', reason: 'unknown status' };
    const g = f['genres'];
    if (g !== undefined && g !== null && (typeof g !== 'string' || genresFromDb(g) === null)) return { field: 'genres', reason: 'not a JSON array of strings' };
  }
  if (tbl === 'ratings') {
    const v = f['verdict'];
    if (v !== undefined && v !== null && !inEnum(VERDICTS, v)) return { field: 'verdict', reason: 'unknown verdict' };
    const r = f['review'];
    if (r !== undefined && r !== null && (typeof r !== 'string' || [...r].length > REVIEW_MAX)) return { field: 'review', reason: 'not a review of at most 1,000 characters' };
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
