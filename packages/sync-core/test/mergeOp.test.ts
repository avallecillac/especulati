import { describe, expect, it } from 'vitest';
import { mergeOp, stampOps, type Hlc, type RemoteOp } from '../src/index.ts';
import { deviceId, uuid } from './fixtures.ts';

const h = (ms: number, c = 0) => `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${deviceId(1)}` as Hlc;
const op = (hlc: Hlc, fields: RemoteOp['fields']): RemoteOp => ({ opId: uuid(1), hlc, deviceId: deviceId(1), tbl: 'notes', rowId: uuid(2), fields });

describe('mergeOp', () => {
  it('wins on fields with no clock or an older one; loses ties', () => {
    const clocks: Record<string, Hlc> = { b: h(5), c: h(10) };
    const wins = mergeOp((f) => clocks[f] ?? null, op(h(10), { a: 1, b: 2, c: 3 }));
    expect(wins).toEqual(['a', 'b']);
  });
});

describe('stampOps', () => {
  it('stamps one strictly increasing HLC per change, in order, and returns the last', () => {
    const ids = [uuid(10), uuid(11)];
    const { ops, hlc } = stampOps(
      [
        { tbl: 'notes', rowId: uuid(2), fields: { body: 'a' } },
        { tbl: 'marks', rowId: uuid(3), fields: { note_id: uuid(2) } },
      ],
      { hlc: null, deviceId: deviceId(1), wallMs: 1_800_000_000_000, newOpId: () => ids.shift()! },
    );
    expect(ops.map((o) => [o.op, o.tbl, o.row])).toEqual([[uuid(10), 'notes', uuid(2)], [uuid(11), 'marks', uuid(3)]]);
    expect(ops[0]!.hlc < ops[1]!.hlc).toBe(true);
    expect(hlc).toBe(ops[1]!.hlc);
  });
});
