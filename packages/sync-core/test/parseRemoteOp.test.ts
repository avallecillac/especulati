import { describe, expect, it } from 'vitest';
import { parseRemoteOpWith, type Hlc, type OpWire, type SyncSchema } from '../src/index.ts';
import { deviceId, uuid } from './fixtures.ts';

// A toy two-table schema: `notes` (own fields) and `marks` (child of a note).
type Tbl = 'notes' | 'marks';
const toy: SyncSchema<Tbl> = {
  writable: { notes: new Set(['body', 'deleted_at']), marks: new Set(['note_id', 'kind']) },
  insertRequired: { notes: ['body'], marks: ['note_id'] },
  tierOf: () => 'base',
};
const parse = parseRemoteOpWith(toy);

const dev = deviceId(1);
const hlc = (ms: number, device = dev) => `${String(ms).padStart(13, '0')}-0000-${device}`;
const wire = (p: Partial<OpWire> = {}): OpWire => ({
  op: uuid(1),
  hlc: hlc(1_790_000_000_000),
  tbl: 'notes',
  row: uuid(2),
  fields: { body: 'hi' },
  ...p,
});

describe('parseRemoteOpWith (toy schema)', () => {
  it('accepts a well-formed op and names the HLC device, not the sender', () => {
    const other = deviceId(2);
    const r = parse(wire({ hlc: hlc(1_790_000_000_000, other), fields: { body: 'x', deleted_at: null } }), dev);
    expect(r).toEqual({
      ok: true,
      value: {
        opId: uuid(1),
        hlc: hlc(1_790_000_000_000, other) as Hlc,
        deviceId: other,
        tbl: 'notes',
        rowId: uuid(2),
        fields: { body: 'x', deleted_at: null },
      },
    });
  });

  it('accepts a table of the other kind', () => {
    expect(parse(wire({ tbl: 'marks', fields: { note_id: uuid(3), kind: 'star' } }), dev).ok).toBe(true);
  });

  it('rejects an unknown table (including inherited names)', () => {
    expect(parse(wire({ tbl: 'items' }), dev)).toEqual({ ok: false, error: { field: 'tbl', reason: 'unknown table' } });
    expect(parse(wire({ tbl: 'constructor' }), dev)).toEqual({ ok: false, error: { field: 'tbl', reason: 'unknown table' } });
  });

  it('rejects a field that is not writable for that table', () => {
    expect(parse(wire({ fields: { kind: 'star' } }), dev)).toEqual({ ok: false, error: { field: 'fields', reason: 'field not writable' } });
    expect(parse(wire({ fields: { id: uuid(9) } }), dev)).toEqual({ ok: false, error: { field: 'fields', reason: 'field not writable' } });
  });

  it('rejects a bad op or row uuid', () => {
    expect(parse(wire({ op: 'nope' }), dev)).toEqual({ ok: false, error: { field: 'op', reason: 'not a lowercase uuid' } });
    expect(parse(wire({ row: uuid(2).toUpperCase().replace(/0/g, 'A') }), dev)).toEqual({ ok: false, error: { field: 'row', reason: 'not a lowercase uuid' } });
  });

  it('rejects a bad sender device', () => {
    expect(parse(wire(), 'not-a-uuid').ok).toBe(false);
  });

  it('rejects a malformed HLC and one over the year-2255 cap', () => {
    expect(parse(wire({ hlc: 'x' }), dev)).toEqual({ ok: false, error: { field: 'hlc', reason: 'malformed hlc' } });
    expect(parse(wire({ hlc: hlc(9_000_000_000_000) }), dev)).toEqual({ ok: false, error: { field: 'hlc', reason: 'too far in the future' } });
    expect(parse(wire({ hlc: hlc(8_999_999_999_999) }), dev).ok).toBe(true);
  });

  it('rejects non-scalar and non-finite values', () => {
    const f = (v: unknown) => parse(wire({ fields: { body: v } as unknown as OpWire['fields'] }), dev);
    const bad = { ok: false, error: { field: 'fields', reason: 'value must be string, number or null' } };
    expect(f({})).toEqual(bad);
    expect(f([1])).toEqual(bad);
    expect(f(true)).toEqual(bad);
    expect(f(Number.POSITIVE_INFINITY)).toEqual(bad);
    expect(f(Number.NaN)).toEqual(bad);
    expect(f(7).ok).toBe(true);
  });

  it('rejects non-object input and non-object fields', () => {
    expect(parse(null as unknown as OpWire, dev)).toEqual({ ok: false, error: { field: 'op', reason: 'not an object' } });
    expect(parse(wire({ fields: [] as unknown as OpWire['fields'] }), dev)).toEqual({ ok: false, error: { field: 'fields', reason: 'not an object' } });
    expect(parse(wire({ fields: null as unknown as OpWire['fields'] }), dev)).toEqual({ ok: false, error: { field: 'fields', reason: 'not an object' } });
  });
});
