import { compareHlc, parseHlc, type Hlc } from './hlc.ts';
import { parseDeviceId, UUID_PATTERN, type DeviceId, type ParseError } from './ids.ts';
import { err, ok, type Result } from './result.ts';

export type FieldValue = string | number | null;

/** One row upsert: only the fields being set. Column names are DB columns. */
export interface Change<T extends string = string> {
  readonly tbl: T;
  readonly rowId: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

/**
 * What an app tells the sync code about its tables. `writable` guards against building SQL from
 * untrusted field names (`id` is never writable: the row id travels separately). `insertRequired`
 * lists the fields an op must carry to create a row that does not exist yet (else it is parked).
 * `tierOf` names the batch tier of an op: a pushed batch never mixes tiers.
 */
export interface SyncSchema<T extends string = string> {
  readonly writable: Readonly<Record<T, ReadonlySet<string>>>;
  readonly insertRequired: Readonly<Record<T, readonly string[]>>;
  tierOf(tbl: T, fields: Readonly<Record<string, FieldValue>>): string;
}

/** One op as it travels inside an encrypted batch. */
export interface OpWire {
  op: string;
  hlc: string;
  tbl: string;
  row: string;
  fields: Record<string, string | number | null>;
}

export interface RemoteOp<T extends string = string> {
  readonly opId: string;
  readonly hlc: Hlc;
  readonly deviceId: DeviceId;
  readonly tbl: T;
  readonly rowId: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

const UUID_RE = new RegExp(`^${UUID_PATTERN}$`);
/** Largest accepted HLC millisecond value (year 2255): leaves room so the 13-digit clock never overflows. */
const MAX_HLC_MS = 8_999_999_999_999;
const fail = (field: string, reason: string) => err<ParseError>({ field, reason });

/**
 * A parser for untrusted wire data under `schema`: known table, allow-listed fields, well-formed
 * ids and HLC. The op's device is the one named in its HLC, not the batch sender: after a reset a
 * device re-pushes ops that other devices made. `device` (the sender) must still be well formed.
 */
export function parseRemoteOpWith<T extends string>(
  schema: SyncSchema<T>,
): (w: OpWire, device: string) => Result<RemoteOp<T>, ParseError> {
  const isTable = (t: string): t is T => Object.prototype.hasOwnProperty.call(schema.writable, t);
  return (w, device) => {
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
    const allowed = schema.writable[w.tbl];
    const fields: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(w.fields)) {
      if (!allowed.has(k)) return fail('fields', 'field not writable');
      if (v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) {
        return fail('fields', 'value must be string, number or null');
      }
      fields[k] = v;
    }
    return ok({ opId: w.op, hlc: w.hlc as Hlc, deviceId: hlc.value.deviceId, tbl: w.tbl, rowId: w.row, fields });
  };
}

/** Field names of `op` that win: no clock yet, or `op.hlc` is newer (per-field LWW). */
export function mergeOp(clockOf: (field: string) => Hlc | null, op: RemoteOp): string[] {
  return Object.keys(op.fields).filter((f) => {
    const c = clockOf(f);
    return c === null || compareHlc(op.hlc, c) === 1;
  });
}
