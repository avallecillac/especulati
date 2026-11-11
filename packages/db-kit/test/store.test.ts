import { describe, expect, it } from 'vitest';
import { applyChanges, SqliteSyncStore } from '../src/index.ts';
import { DEVICE, T0, h, op, openToyDb, toyCanInsert, toySchema, uuid } from './helpers.ts';

let n = 0;
const newOpId = () => uuid(0x200 + ++n);
const wall = () => T0;
const store = (raw = openToyDb(), onApply?: () => void) => new SqliteSyncStore(raw, toySchema, toyCanInsert, onApply);

describe('SqliteSyncStore', () => {
  it('syncMeta defaults, set/patch semantics (undefined keeps, null removes)', () => {
    const s = store();
    expect(s.syncMeta()).toEqual({ key: null, cursor: 0, pendingBatch: null, status: null, oldSpace: null });
    s.setSyncMeta({ key: 'k', cursor: 7, pendingBatch: { batchId: 'b', maxSeq: 3 }, status: { lastOkAt: 't', problem: null, undecryptable: 1 }, oldSpace: 'o' });
    expect(s.syncMeta()).toEqual({ key: 'k', cursor: 7, pendingBatch: { batchId: 'b', maxSeq: 3 }, status: { lastOkAt: 't', problem: null, undecryptable: 1 }, oldSpace: 'o' });
    s.setSyncMeta({ key: null, cursor: null });
    expect(s.syncMeta()).toMatchObject({ key: null, cursor: 0, oldSpace: 'o' });
    expect(s.getMeta('sync_old_space')).toBe('o');
    expect(s.getMeta('nope')).toBeNull();
  });

  it('unpushedOps makes single-tier batches and re-sends up to a seq', () => {
    const raw = openToyDb();
    const s = store(raw);
    applyChanges(raw, toySchema, [
      { tbl: 'notes', rowId: uuid(1), fields: { body: 'a' } },
      { tbl: 'notes', rowId: uuid(2), fields: { body: 'b' } },
      { tbl: 'marks', rowId: uuid(3), fields: { note_id: uuid(1), label: 'm' } },
      { tbl: 'notes', rowId: uuid(4), fields: { body: 'c' } },
    ], DEVICE, wall, newOpId);
    const first = s.unpushedOps(10);
    expect(first.ops.map((o) => o.tbl)).toEqual(['notes', 'notes']);
    expect(first.maxSeq).toBe(2);
    const resend = s.unpushedOps(10, 3);
    expect(resend.ops.map((o) => o.tbl)).toEqual(['notes', 'notes', 'marks']);
    expect(resend.maxSeq).toBe(3);
    expect(s.pendingCount()).toBe(4);
  });

  it('completePush marks rows pushed and clears pending_batch together', () => {
    const raw = openToyDb();
    const s = store(raw);
    applyChanges(raw, toySchema, [{ tbl: 'notes', rowId: uuid(1), fields: { body: 'a' } }, { tbl: 'notes', rowId: uuid(2), fields: { body: 'b' } }], DEVICE, wall, newOpId);
    s.setSyncMeta({ pendingBatch: { batchId: 'b', maxSeq: 1 } });
    s.completePush(1);
    expect(s.pendingCount()).toBe(1);
    expect(s.syncMeta().pendingBatch).toBeNull();
  });

  it('resetPushState re-queues everything and restarts the cursor', () => {
    const raw = openToyDb();
    const s = store(raw);
    applyChanges(raw, toySchema, [{ tbl: 'notes', rowId: uuid(1), fields: { body: 'a' } }], DEVICE, wall, newOpId);
    s.completePush(1);
    s.setSyncMeta({ cursor: 9 });
    s.resetPushState();
    expect(s.pendingCount()).toBe(1);
    expect(s.syncMeta().cursor).toBe(0);
  });

  it('applyPulledPage applies ops, advances the cursor and exposes the inbox; onApply fires first', () => {
    let fired = 0;
    const s = store(openToyDb(), () => fired++);
    const mark = op('marks', uuid(2), { note_id: uuid(1), label: 'm' }, h(T0 + 1));
    expect(s.applyPulledPage([mark], 5, wall)).toEqual({ applied: 0, skipped: 0, parked: 1 });
    expect(s.syncMeta().cursor).toBe(5);
    expect(s.inboxOpIds()).toEqual([mark.opId]);
    expect(s.applyPulledPage([op('notes', uuid(1), { body: 'n' }, h(T0))], 6, wall).applied).toBe(2);
    expect(s.inboxOpIds()).toEqual([]);
    expect(fired).toBe(2);
  });

  it('applyPulledPage rolls the cursor back with the page when an op is corrupt', () => {
    const raw = openToyDb();
    const s = store(raw);
    raw.exec("INSERT INTO sync_inbox (op_id, hlc, device_id, tbl, row_id, fields_json) VALUES (?, ?, ?, 'nope', ?, '{}')", { bind: [uuid(9), h(T0), uuid(0xbeef), uuid(9)] });
    expect(() => s.applyPulledPage([], 4, wall)).toThrow();
    expect(s.syncMeta().cursor).toBe(0);
  });

  it('needs a device id', () => {
    const raw = openToyDb();
    raw.exec("DELETE FROM meta WHERE key = 'device_id'");
    expect(() => store(raw).applyPulledPage([], 1, wall)).toThrow('device id');
  });
});
