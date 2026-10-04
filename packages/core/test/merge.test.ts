import { describe, expect, it } from 'vitest';
import { compareHlc, hlcReceive, INSERT_FIELDS, mergeOp, parseRemoteOp, tierOf, WRITABLE_FIELDS, type Hlc, type OpWire } from '../src/index.ts';
import { deviceId, uuid } from './fixtures.ts';

const ours = deviceId(1);
const theirs = deviceId(2);
const h = (ms: number, counter: number, dev = theirs) =>
  `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${dev}` as Hlc;

describe('hlcReceive', () => {
  it('uses wallMs with counter 0 when it is the largest', () => {
    expect(hlcReceive(h(1000, 5, ours), h(2000, 3), 3000, ours)).toBe(h(3000, 0, ours));
  });

  it('uses the remote ms and its counter + 1 when the remote is the largest', () => {
    expect(hlcReceive(h(1000, 5, ours), h(4000, 7), 3000, ours)).toBe(h(4000, 8, ours));
  });

  it('uses the local ms and its counter + 1 when local is the largest', () => {
    expect(hlcReceive(h(5000, 2, ours), h(4000, 7), 3000, ours)).toBe(h(5000, 3, ours));
  });

  it('uses max counter + 1 on equal ms', () => {
    expect(hlcReceive(h(4000, 2, ours), h(4000, 7), 3000, ours)).toBe(h(4000, 8, ours));
    expect(hlcReceive(h(4000, 9, ours), h(4000, 7), 4000, ours)).toBe(h(4000, 10, ours));
  });

  it('rolls to ms + 1 when the counter would overflow', () => {
    expect(hlcReceive(h(4000, 9999, ours), h(4000, 3), 10, ours)).toBe(h(4001, 0, ours));
    expect(hlcReceive(h(1000, 0, ours), h(4000, 9999), 10, ours)).toBe(h(4001, 0, ours));
  });

  it('works with a null local', () => {
    expect(hlcReceive(null, h(4000, 1), 10, ours)).toBe(h(4000, 2, ours));
    expect(hlcReceive(null, h(4000, 1), 9000, ours)).toBe(h(9000, 0, ours));
  });

  it('carries our device id and is greater than both inputs', () => {
    const local = h(4000, 4, ours);
    const remote = h(4000, 4, deviceId(9));
    const r = hlcReceive(local, remote, 1, ours);
    expect(r.endsWith(ours)).toBe(true);
    expect(compareHlc(r, local)).toBe(1);
    expect(compareHlc(r, remote)).toBe(1);
  });
});

const wire = (p: Partial<OpWire> = {}): OpWire => ({
  op: uuid(500),
  hlc: h(4000, 0),
  tbl: 'items',
  row: uuid(1),
  fields: { title: 'Dune' },
  ...p,
});

describe('parseRemoteOp', () => {
  it('parses a valid op', () => {
    const r = parseRemoteOp(wire(), theirs);
    expect(r).toEqual({
      ok: true,
      value: { opId: uuid(500), hlc: h(4000, 0), deviceId: theirs, tbl: 'items', rowId: uuid(1), fields: { title: 'Dune' } },
    });
  });

  it('rejects an unknown table', () => {
    expect(parseRemoteOp(wire({ tbl: 'covers' }), theirs).ok).toBe(false);
    expect(parseRemoteOp(wire({ tbl: 'meta' }), theirs).ok).toBe(false);
  });

  it('rejects fields outside the table writable set', () => {
    expect(parseRemoteOp(wire({ fields: { id: uuid(2) } }), theirs).ok).toBe(false);
    expect(parseRemoteOp(wire({ fields: { title: 'x', evil: 1 } }), theirs).ok).toBe(false);
    expect(parseRemoteOp(wire({ tbl: 'reading_events', fields: { title: 'x' } }), theirs).ok).toBe(false);
    expect(parseRemoteOp(wire({ fields: { 'title) --': 'x' } }), theirs).ok).toBe(false);
  });

  it('rejects a malformed hlc, op id, row id or device', () => {
    expect(parseRemoteOp(wire({ hlc: 'nope' }), theirs).ok).toBe(false);
    expect(parseRemoteOp(wire({ op: 'not-a-uuid' }), theirs).ok).toBe(false);
    expect(parseRemoteOp(wire({ row: 'x' }), theirs).ok).toBe(false);
    expect(parseRemoteOp(wire(), 'dev').ok).toBe(false);
  });

  it('takes the device from the HLC, not the batch sender (a reset re-pushes other devices\' ops)', () => {
    const other = deviceId(7);
    const r = parseRemoteOp(wire({ hlc: h(4000, 0, other) }), theirs);
    expect(r.ok && r.value.deviceId).toBe(other);
  });

  it('rejects an HLC far enough in the future to overflow the 13-digit clock', () => {
    expect(parseRemoteOp(wire({ hlc: h(9_000_000_000_000, 0) }), theirs).ok).toBe(false);
    expect(parseRemoteOp(wire({ hlc: h(8_999_999_999_999, 0) }), theirs).ok).toBe(true);
  });

  it('rejects non-scalar field values', () => {
    expect(parseRemoteOp(wire({ fields: { title: { a: 1 } as never } }), theirs).ok).toBe(false);
  });

  it('accepts the new writable fields', () => {
    expect(WRITABLE_FIELDS.items.has('merged_into')).toBe(true);
    expect([...WRITABLE_FIELDS.duplicate_dismissals].sort()).toEqual(['created_at', 'deleted_at', 'item_a', 'item_b']);
    const r = parseRemoteOp(wire({ tbl: 'duplicate_dismissals', fields: { item_a: uuid(1), item_b: uuid(2), created_at: 'x' } }), theirs);
    expect(r.ok).toBe(true);
  });
});

describe('mergeOp', () => {
  const op = (parseRemoteOp(wire({ fields: { title: 'A', author: 'B', rating: 3 } }), theirs) as { ok: true; value: never }).value;
  it('a field wins iff its clock is null or older', () => {
    const clocks: Record<string, Hlc> = { title: h(3999, 9999), author: h(4000, 0), rating: h(4001, 0) };
    expect(mergeOp((f) => clocks[f] ?? null, op)).toEqual(['title']);
    expect(mergeOp(() => null, op).sort()).toEqual(['author', 'rating', 'title']);
  });
});

describe('highlights in the sync allow-lists (007)', () => {
  const FIELDS = ['item_id', 'quote', 'note', 'page', 'created_at', 'local_date', 'deleted_at'];
  const wire = (fields: OpWire['fields']): OpWire => ({ op: uuid(1), hlc: h(1000, 0), tbl: 'highlights', row: uuid(2), fields });

  it('parseRemoteOp accepts every writable highlights field', () => {
    expect([...WRITABLE_FIELDS.highlights].sort()).toEqual([...FIELDS].sort());
    const fields = Object.fromEntries(FIELDS.map((f) => [f, f === 'page' ? 3 : 'x']));
    const r = parseRemoteOp(wire(fields), theirs);
    expect(r.ok && r.value.tbl).toBe('highlights');
  });

  it('parseRemoteOp rejects any other highlights field', () => {
    for (const f of ['id', 'itemId', 'text', 'merged_into', 'rating']) {
      expect(parseRemoteOp(wire({ [f]: 'x' }), theirs).ok).toBe(false);
    }
  });

  it('INSERT_FIELDS.highlights is item_id, created_at, local_date', () => {
    expect(INSERT_FIELDS.highlights).toEqual(['item_id', 'created_at', 'local_date']);
  });

  it('tierOf is h for highlights and base for the other tables', () => {
    expect(tierOf('highlights')).toBe('h');
    expect(tierOf('items')).toBe('base');
    expect(tierOf('reading_events')).toBe('base');
    expect(tierOf('duplicate_dismissals')).toBe('base');
  });
});
