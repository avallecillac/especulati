import { describe, expect, it } from 'vitest';
import { hlcNext, stampOps, type Change, type Hlc } from '../src/index.ts';
import { deviceId, uuid } from './fixtures.ts';

const dev = deviceId(1);
const changes: Change[] = [
  { tbl: 'items', rowId: uuid(1), fields: { type: 'article', title: 'A' } },
  { tbl: 'reading_events', rowId: uuid(2), fields: { item_id: uuid(1), page: null } },
  { tbl: 'items', rowId: uuid(3), fields: { deleted_at: '2026-09-27T12:00:00.000Z' } },
];
const ids = () => {
  let n = 0;
  return () => uuid(0x500 + ++n);
};

describe('stampOps', () => {
  it('makes one op per change, in order', () => {
    const { ops } = stampOps(changes, { hlc: null, deviceId: dev, wallMs: 1_800_000_000_000, newOpId: ids() });
    expect(ops.map((o) => [o.tbl, o.row])).toEqual(changes.map((c) => [c.tbl, c.rowId]));
  });

  it('op fields equal the change fields, and op ids come from newOpId', () => {
    const { ops } = stampOps(changes, { hlc: null, deviceId: dev, wallMs: 1_800_000_000_000, newOpId: ids() });
    expect(ops.map((o) => o.fields)).toEqual(changes.map((c) => c.fields));
    expect(ops.map((o) => o.op)).toEqual([uuid(0x501), uuid(0x502), uuid(0x503)]);
  });

  it('HLCs use hlcNext semantics and strictly increase after the given hlc', () => {
    const prev = hlcNext(null, 1_800_000_000_000, dev);
    const { ops, hlc } = stampOps(changes, { hlc: prev, deviceId: dev, wallMs: 1_700_000_000_000, newOpId: ids() });
    let expected: Hlc = prev;
    for (const o of ops) {
      expected = hlcNext(expected, 1_700_000_000_000, dev);
      expect(o.hlc).toBe(expected);
    }
    expect(hlc).toBe(ops.at(-1)!.hlc);
    expect([prev, ...ops.map((o) => o.hlc)]).toEqual([prev, ...ops.map((o) => o.hlc)].sort());
    expect(new Set(ops.map((o) => o.hlc)).size).toBe(3);
  });

  it('a later wall clock restarts the counter with the device id in every stamp', () => {
    const prev = hlcNext(null, 1_800_000_000_000, dev);
    const { ops } = stampOps(changes, { hlc: prev, deviceId: dev, wallMs: 1_800_000_000_500, newOpId: ids() });
    expect(ops[0]!.hlc).toBe('1800000000500-0000-' + dev);
    expect(ops[2]!.hlc).toBe('1800000000500-0002-' + dev);
  });

  it('no changes: no ops and the hlc is unchanged', () => {
    const prev = hlcNext(null, 1_800_000_000_000, dev);
    expect(stampOps([], { hlc: prev, deviceId: dev, wallMs: 1, newOpId: ids() })).toEqual({ ops: [], hlc: prev });
    expect(stampOps([], { hlc: null, deviceId: dev, wallMs: 1, newOpId: ids() })).toEqual({ ops: [], hlc: null });
  });

  it('copies the fields, so later mutation of a change does not alter an op', () => {
    const c: Change = { tbl: 'items', rowId: uuid(1), fields: { title: 'A' } };
    const { ops } = stampOps([c], { hlc: null, deviceId: dev, wallMs: 1, newOpId: ids() });
    expect(ops[0]!.fields).not.toBe(c.fields);
  });
});
