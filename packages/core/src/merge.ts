import { compareHlc, parseHlc, type Hlc } from './hlc.ts';
import type { FieldValue, Table } from './commands.ts';
import { err, ok, type Result } from './result.ts';
import { parseDeviceId, UUID_PATTERN, type DeviceId, type ParseError } from './types.ts';

/**
 * Columns a Change (local or remote) may set, per table. Guards against building SQL from
 * untrusted field names. `id` is never writable: the row id travels separately.
 */
export const WRITABLE_FIELDS: Readonly<Record<Table, ReadonlySet<string>>> = {
  items: new Set([
    'type', 'title', 'author', 'isbn', 'total_pages', 'genre', 'cover_url', 'cover_blob_key',
    'url', 'domain', 'word_count', 'read_on', 'metadata_status', 'rating', 'created_at', 'deleted_at',
    'merged_into',
  ]),
  reading_events: new Set(['item_id', 'event_type', 'page', 'occurred_at', 'local_date', 'deleted_at']),
  duplicate_dismissals: new Set(['item_a', 'item_b', 'created_at', 'deleted_at']),
  highlights: new Set(['item_id', 'quote', 'note', 'page', 'created_at', 'local_date', 'deleted_at']),
  tags: new Set(['name', 'name_key', 'created_at', 'deleted_at']),
  item_tags: new Set(['item_id', 'tag_id', 'created_at', 'deleted_at']),
};

/** Fields an op must carry to create a row that does not exist yet (else it is parked). */
export const INSERT_FIELDS: Readonly<Record<Table, readonly string[]>> = {
  items: ['type', 'title', 'created_at'],
  reading_events: ['item_id', 'event_type', 'occurred_at', 'local_date'],
  duplicate_dismissals: ['item_a', 'item_b', 'created_at'],
  highlights: ['item_id', 'created_at', 'local_date'],
  tags: ['name', 'name_key', 'created_at'],
  item_tags: ['item_id', 'tag_id', 'created_at'],
};

/**
 * Sync batch tier (007 R2, 008 R2): a pushed batch never mixes tiers, so an older device skips only
 * whole batches it can't read. `h` highlights; `t` tags and item_tags; `s` an items op that sets
 * `read_on` to null (a saved article, which 0.8.0 cannot read); `base` everything else. The `s` test
 * needs the key present with a null value, so a saved insert must name `read_on` explicitly.
 * Lives in core so db and sync share it.
 */
export function tierOf(tbl: Table, fields: Readonly<Record<string, FieldValue>>): 'base' | 'h' | 't' | 's' {
  if (tbl === 'highlights') return 'h';
  if (tbl === 'tags' || tbl === 'item_tags') return 't';
  if (tbl === 'items' && Object.prototype.hasOwnProperty.call(fields, 'read_on') && fields['read_on'] === null) return 's';
  return 'base';
}

/** One op as it travels inside an encrypted batch (contracts/sync-client.md). */
export interface OpWire {
  op: string;
  hlc: string;
  tbl: string;
  row: string;
  fields: Record<string, string | number | null>;
}

export interface RemoteOp {
  readonly opId: string;
  readonly hlc: Hlc;
  readonly deviceId: DeviceId;
  readonly tbl: Table;
  readonly rowId: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

const UUID_RE = new RegExp(`^${UUID_PATTERN}$`);
/** Largest accepted HLC millisecond value (year 2255): leaves room so the 13-digit clock never overflows. */
const MAX_HLC_MS = 8_999_999_999_999;
const fail = (field: string, reason: string) => err<ParseError>({ field, reason });
const isTable = (t: string): t is Table => Object.prototype.hasOwnProperty.call(WRITABLE_FIELDS, t);

/**
 * Validate untrusted wire data: known table, allow-listed fields, well-formed ids and HLC.
 * The op's device is the one named in its HLC, not the batch sender: after a reset a device
 * re-pushes ops that other devices made. `device` (the sender) must still be well formed.
 */
export function parseRemoteOp(w: OpWire, device: string): Result<RemoteOp, ParseError> {
  if (typeof w !== 'object' || w === null) return fail('op', 'not an object');
  if (typeof w.op !== 'string' || !UUID_RE.test(w.op)) return fail('op', 'not a lowercase uuid');
  if (typeof w.row !== 'string' || !UUID_RE.test(w.row)) return fail('row', 'not a lowercase uuid');
  if (typeof w.tbl !== 'string' || !isTable(w.tbl)) return fail('tbl', 'unknown table');
  const dev = parseDeviceId(device);
  if (!dev.ok) return dev;
  if (typeof w.hlc !== 'string') return fail('hlc', 'malformed hlc');
  const hlc = parseHlc(w.hlc);
  if (!hlc.ok) return hlc;
  if (hlc.value.ms > MAX_HLC_MS) return fail('hlc', 'too far in the future');
  if (typeof w.fields !== 'object' || w.fields === null || Array.isArray(w.fields)) return fail('fields', 'not an object');
  const allowed = WRITABLE_FIELDS[w.tbl];
  const fields: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(w.fields)) {
    if (!allowed.has(k)) return fail('fields', 'field not writable');
    if (v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) {
      return fail('fields', 'value must be string, number or null');
    }
    fields[k] = v;
  }
  return ok({ opId: w.op, hlc: w.hlc as Hlc, deviceId: hlc.value.deviceId, tbl: w.tbl, rowId: w.row, fields });
}

/** Field names of `op` that win: no clock yet, or `op.hlc` is newer (per-field LWW). */
export function mergeOp(clockOf: (field: string) => Hlc | null, op: RemoteOp): string[] {
  return Object.keys(op.fields).filter((f) => {
    const c = clockOf(f);
    return c === null || compareHlc(op.hlc, c) === 1;
  });
}
