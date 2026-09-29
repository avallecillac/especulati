import { describe, expect, it } from 'vitest';
import { parseRemoteOp, type OpWire, type RemoteOp } from '@readerlog/core';
import { applyRemoteOps, markPushed, resetPushState, unpushedOps, syncMeta, setSyncMeta } from '../src/index.ts';
import { DEVICE, openTestDb, uuid } from './helpers.ts';

const REMOTE = uuid(0xbeef);
const h = (ms: number, counter = 0, dev: string = REMOTE) =>
  `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${dev}`;
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);

let n = 0;
function op(tbl: string, row: string, fields: OpWire['fields'], hlc: string, opId?: string): RemoteOp {
  const r = parseRemoteOp({ op: opId ?? uuid(0x7000 + ++n), hlc, tbl, row, fields }, REMOTE);
  if (!r.ok) throw new Error(`bad test op: ${JSON.stringify(r.error)}`);
  return r.value;
}
const itemInsert = (row: string, hlc: string, extra: OpWire['fields'] = {}) =>
  op('items', row, { type: 'book', title: 'Dune', created_at: '2026-09-01T10:00:00.000Z', ...extra }, hlc);

const wall = () => T0 + 5000;

describe('applyRemoteOps', () => {
  it('inserts a remote item, sets field_clock for every field and logs the op as pushed', () => {
    const { raw } = openTestDb();
    const o = itemInsert(uuid(1), h(T0));
    expect(applyRemoteOps(raw, [o], DEVICE, wall)).toEqual({ applied: 1, skipped: 0, parked: 0 });
    expect(raw.selectObjects('SELECT title, type FROM items WHERE id = ?', [uuid(1)])).toEqual([{ title: 'Dune', type: 'book' }]);
    const clocks = raw.selectArrays('SELECT field, hlc FROM field_clock WHERE row_id = ? ORDER BY field', [uuid(1)]);
    expect(clocks.map((c) => c[0])).toEqual(['created_at', 'title', 'type']);
    expect(clocks.every((c) => c[1] === o.hlc)).toBe(true);
    expect(raw.selectObjects('SELECT op_id, hlc, device_id, pushed FROM change_log WHERE op_id = ?', [o.opId])).toEqual([
      { op_id: o.opId, hlc: o.hlc, device_id: REMOTE, pushed: 1 },
    ]);
  });

  it('skips a duplicate op_id and changes nothing', () => {
    const { raw } = openTestDb();
    const o = itemInsert(uuid(1), h(T0));
    applyRemoteOps(raw, [o], DEVICE, wall);
    const dump = JSON.stringify([raw.selectArrays('SELECT * FROM items'), raw.selectArrays('SELECT * FROM change_log'), raw.selectArrays('SELECT * FROM field_clock')]);
    const again = op('items', uuid(1), { title: 'Changed' }, h(T0 + 100), o.opId);
    expect(applyRemoteOps(raw, [o, again], DEVICE, wall)).toEqual({ applied: 0, skipped: 2, parked: 0 });
    expect(JSON.stringify([raw.selectArrays('SELECT * FROM items'), raw.selectArrays('SELECT * FROM change_log'), raw.selectArrays('SELECT * FROM field_clock')])).toBe(dump);
  });

  it('an older remote edit loses to a newer local edit; a newer one wins; different fields merge', () => {
    const t = openTestDb();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(1), title: 'Local', startNow: false, localDate: '2026-09-01' }, t.env);
    t.tick();
    t.db.dispatch({ kind: 'EditBook', itemId: uuid(1), title: 'Local2', author: 'Frank' } as never, t.env);
    const localTitleClock = t.raw.selectValue(`SELECT hlc FROM field_clock WHERE row_id=? AND field='title'`, [uuid(1)]) as string;
    const older = h(T0 - 10_000);
    expect(older < localTitleClock).toBe(true);
    applyRemoteOps(t.raw, [op('items', uuid(1), { title: 'Old', genre: 'SF' }, older)], DEVICE, wall);
    expect(t.raw.selectObjects('SELECT title, genre FROM items WHERE id=?', [uuid(1)])).toEqual([{ title: 'Local2', genre: 'SF' }]);
    const newer = h(T0 + 60_000);
    applyRemoteOps(t.raw, [op('items', uuid(1), { title: 'New' }, newer)], DEVICE, wall);
    expect(t.raw.selectObjects('SELECT title, genre, author FROM items WHERE id=?', [uuid(1)])).toEqual([{ title: 'New', genre: 'SF', author: 'Frank' }]);
    expect(t.raw.selectValue(`SELECT hlc FROM field_clock WHERE row_id=? AND field='title'`, [uuid(1)])).toBe(newer);
  });

  it('records an op whose fields all lose, so it is not treated as new again', () => {
    const { raw } = openTestDb();
    applyRemoteOps(raw, [itemInsert(uuid(1), h(T0 + 100))], DEVICE, wall);
    const loser = op('items', uuid(1), { title: 'Loser' }, h(T0));
    expect(applyRemoteOps(raw, [loser], DEVICE, wall).applied).toBe(1);
    expect(raw.selectValue('SELECT title FROM items WHERE id=?', [uuid(1)])).toBe('Dune');
    expect(applyRemoteOps(raw, [loser], DEVICE, wall)).toEqual({ applied: 0, skipped: 1, parked: 0 });
  });

  it('a newer remote tombstone wins over a local edit', () => {
    const t = openTestDb();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(1), title: 'Local', startNow: false, localDate: '2026-09-01' }, t.env);
    applyRemoteOps(t.raw, [op('items', uuid(1), { deleted_at: '2026-09-28T00:00:00.000Z' }, h(T0 + 60_000))], DEVICE, wall);
    expect(t.raw.selectValue('SELECT deleted_at FROM items WHERE id=?', [uuid(1)])).toBe('2026-09-28T00:00:00.000Z');
  });

  it('parks an edit that arrives before its insert, then applies it and empties the inbox', () => {
    const { raw } = openTestDb();
    const edit = op('items', uuid(1), { title: 'Edited' }, h(T0 + 10));
    expect(applyRemoteOps(raw, [edit], DEVICE, wall)).toEqual({ applied: 0, skipped: 0, parked: 1 });
    expect(raw.selectValue('SELECT count(*) FROM sync_inbox')).toBe(1);
    expect(raw.selectValue('SELECT count(*) FROM change_log WHERE op_id = ?', [edit.opId])).toBe(0);
    expect(applyRemoteOps(raw, [itemInsert(uuid(1), h(T0))], DEVICE, wall).applied).toBe(2);
    expect(raw.selectValue('SELECT count(*) FROM sync_inbox')).toBe(0);
    expect(raw.selectValue('SELECT title FROM items WHERE id=?', [uuid(1)])).toBe('Edited');
    expect(raw.selectValue('SELECT count(*) FROM change_log WHERE op_id = ?', [edit.opId])).toBe(1);
  });

  it('parks events and dismissals lacking insert fields; applies them once complete', () => {
    const { raw } = openTestDb();
    const ev = op('reading_events', uuid(50), { item_id: uuid(1), event_type: 'started', occurred_at: '2026-09-01T10:00:00.000Z', local_date: '2026-09-01' }, h(T0 + 1));
    const evTomb = op('reading_events', uuid(50), { deleted_at: '2026-09-02T00:00:00.000Z' }, h(T0 + 2));
    const dis = op('duplicate_dismissals', uuid(60), { deleted_at: '2026-09-02T00:00:00.000Z' }, h(T0 + 3));
    // The full event insert is parked too while its parent item is missing (FK).
    expect(applyRemoteOps(raw, [evTomb, dis, ev], DEVICE, wall).parked).toBe(3);
    expect(raw.selectValue('SELECT count(*) FROM sync_inbox')).toBe(3);
    const dinsert = op('duplicate_dismissals', uuid(60), { item_a: uuid(1), item_b: uuid(2), created_at: '2026-09-01T00:00:00.000Z' }, h(T0));
    applyRemoteOps(raw, [itemInsert(uuid(1), h(T0)), dinsert], DEVICE, wall);
    expect(raw.selectValue('SELECT count(*) FROM sync_inbox')).toBe(0);
    expect(raw.selectValue('SELECT deleted_at FROM reading_events WHERE id=?', [uuid(50)])).toBe('2026-09-02T00:00:00.000Z');
    expect(raw.selectValue('SELECT deleted_at FROM duplicate_dismissals WHERE id=?', [uuid(60)])).toBe('2026-09-02T00:00:00.000Z');
  });

  it('advances meta.hlc past every received hlc and later local writes stamp greater', () => {
    const t = openTestDb();
    const far = h(T0 + 3_600_000, 4);
    applyRemoteOps(t.raw, [itemInsert(uuid(1), far)], DEVICE, wall);
    const mh = t.db.getMeta('hlc') as string;
    expect(mh > far).toBe(true);
    expect(mh.endsWith(DEVICE)).toBe(true);
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(2), title: 'Emma', startNow: false, localDate: '2026-09-02' }, t.env);
    const local = t.raw.selectValue(`SELECT hlc FROM change_log WHERE row_id=? ORDER BY seq DESC LIMIT 1`, [uuid(2)]) as string;
    expect(local > mh).toBe(true);
  });

  it('rolls back everything (rows, inbox, cursor) when an op throws mid-batch', () => {
    const { raw, db } = openTestDb();
    setSyncMeta(raw, { cursor: 7 });
    const parkedFirst = op('items', uuid(3), { title: 'Parked' }, h(T0 + 5));
    const good = itemInsert(uuid(1), h(T0));
    // rating 9 violates the CHECK constraint, throwing mid-batch.
    const bad = itemInsert(uuid(2), h(T0 + 1), { rating: 9 });
    const before = raw.selectValue('SELECT count(*) FROM change_log');
    expect(() => applyRemoteOps(raw, [parkedFirst, good, bad], DEVICE, wall)).toThrow();
    expect(raw.selectValue('SELECT count(*) FROM items')).toBe(0);
    expect(raw.selectValue('SELECT count(*) FROM sync_inbox')).toBe(0);
    expect(raw.selectValue('SELECT count(*) FROM change_log')).toBe(before);
    expect(raw.selectValue('SELECT count(*) FROM field_clock')).toBe(0);
    expect(db.getMeta('hlc')).toBeNull();
    expect(syncMeta(raw).cursor).toBe(7);
  });
});

describe('unpushedOps / markPushed / resetPushState', () => {
  function seeded() {
    const t = openTestDb();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(1), title: 'A', startNow: true, startEventId: uuid(101), localDate: '2026-09-01' }, t.env);
    t.tick();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(2), title: 'B', startNow: false, localDate: '2026-09-02' }, t.env);
    applyRemoteOps(t.raw, [itemInsert(uuid(3), h(T0))], DEVICE, wall);
    return t;
  }

  it('returns only local rows in seq order as OpWire, honoring limit; markPushed marks seq <= maxSeq', () => {
    const { raw } = seeded();
    const all = unpushedOps(raw, 100);
    expect(all.ops.length).toBe(3);
    expect(all.ops.map((o) => o.tbl)).toEqual(['items', 'reading_events', 'items']);
    expect(all.ops.every((o) => o.row !== uuid(3))).toBe(true);
    for (const o of all.ops) expect(Object.keys(o).sort()).toEqual(['fields', 'hlc', 'op', 'row', 'tbl']);
    const seqs = raw.selectArrays('SELECT seq FROM change_log WHERE pushed = 0 ORDER BY seq').map((r) => r[0] as number);
    expect(all.maxSeq).toBe(seqs.at(-1));
    const first = unpushedOps(raw, 2);
    expect(first.ops.length).toBe(2);
    expect(first.maxSeq).toBe(seqs[1]);
    markPushed(raw, first.maxSeq);
    const rest = unpushedOps(raw, 100);
    expect(rest.ops.length).toBe(1);
    expect(rest.ops[0]!.op).toBe(all.ops[2]!.op);
    markPushed(raw, rest.maxSeq);
    expect(unpushedOps(raw, 100)).toEqual({ maxSeq: 0, ops: [] });
  });

  it('resetPushState sets every row to pushed = 0 and the cursor to 0', () => {
    const { raw } = seeded();
    setSyncMeta(raw, { cursor: 42 });
    markPushed(raw, 1000);
    resetPushState(raw);
    expect(raw.selectValue('SELECT count(*) FROM change_log WHERE pushed = 1')).toBe(0);
    expect(unpushedOps(raw, 100).ops.length).toBe(4);
    expect(syncMeta(raw).cursor).toBe(0);
  });
});

describe('syncMeta', () => {
  it('round-trips the meta keys and defaults', () => {
    const { raw } = openTestDb();
    expect(syncMeta(raw)).toEqual({ key: null, cursor: 0, pendingBatch: null, status: null, oldSpace: null });
    const status = { lastOkAt: '2026-09-27T12:00:00.000Z' as never, problem: null, undecryptable: 0 };
    setSyncMeta(raw, { key: 'K', cursor: 5, pendingBatch: { batchId: 'b', maxSeq: 9 }, status, oldSpace: 'sp' });
    expect(syncMeta(raw)).toEqual({ key: 'K', cursor: 5, pendingBatch: { batchId: 'b', maxSeq: 9 }, status, oldSpace: 'sp' });
    expect(raw.selectValue(`SELECT value FROM meta WHERE key='sync_cursor'`)).toBe('5');
    setSyncMeta(raw, { key: null, pendingBatch: null, oldSpace: null });
    expect(syncMeta(raw)).toMatchObject({ key: null, cursor: 5, pendingBatch: null, oldSpace: null });
    expect(raw.selectValue(`SELECT count(*) FROM meta WHERE key IN ('sync_key','pending_batch','sync_old_space')`)).toBe(0);
  });
});
