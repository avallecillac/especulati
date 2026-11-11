import { describe, expect, it } from 'vitest';
import { parseRemoteOp, type OpWire } from '@especulati/lector-core';
import { syncMeta } from '../src/index.ts';
import { openTestDb, uuid } from './helpers.ts';

const REMOTE = uuid(0xbeef);
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const h = (ms: number) => `${String(ms).padStart(13, '0')}-0000-${REMOTE}`;
const mk = (n: number, row: string, fields: OpWire['fields']) => {
  const r = parseRemoteOp({ op: uuid(0x7100 + n), hlc: h(T0 + n), tbl: 'items', row, fields }, REMOTE);
  if (!r.ok) throw new Error('bad');
  return r.value;
};

describe('applyPulledPage / completePush', () => {
  it('applies ops and advances the cursor together', () => {
    const t = openTestDb();
    const o = mk(1, uuid(1), { type: 'book', title: 'A', created_at: '2026-09-01T10:00:00.000Z' });
    const r = t.db.applyPulledPage([o], 7, () => T0 + 5000);
    expect(r.applied).toBe(1);
    expect(syncMeta(t.raw).cursor).toBe(7);
    expect(t.raw.selectValue('SELECT COUNT(*) FROM items')).toBe(1);
  });

  it('an exception rolls back both the rows and the cursor', () => {
    const t = openTestDb();
    const o = mk(1, uuid(1), { type: 'book', title: 'A', created_at: '2026-09-01T10:00:00.000Z' });
    let calls = 0;
    const boom = () => {
      if (++calls > 0) throw new Error('boom');
      return 0;
    };
    expect(() => t.db.applyPulledPage([o], 7, boom)).toThrow('boom');
    expect(syncMeta(t.raw).cursor).toBe(0);
    expect(t.raw.selectValue('SELECT COUNT(*) FROM items')).toBe(0);
    expect(t.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(0);
  });

  it('completePush marks rows pushed and clears the pending batch in one step', () => {
    const t = openTestDb();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(1), title: 'A', startNow: false, localDate: '2026-09-01' }, t.env);
    const { maxSeq, ops } = t.db.unpushedOps(500);
    expect(ops.length).toBeGreaterThan(0);
    t.db.setSyncMeta({ pendingBatch: { batchId: uuid(9), maxSeq } });
    t.db.completePush(maxSeq);
    expect(t.db.unpushedOps(500).ops).toEqual([]);
    expect(syncMeta(t.raw).pendingBatch).toBeNull();
    expect(t.db.pendingCount()).toBe(0);
  });

  it('unpushedOps can be bounded by seq', () => {
    const t = openTestDb();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(1), title: 'A', startNow: false, localDate: '2026-09-01' }, t.env);
    const first = t.db.unpushedOps(500);
    t.tick();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(2), title: 'B', startNow: false, localDate: '2026-09-01' }, t.env);
    const bounded = t.db.unpushedOps(500, first.maxSeq);
    expect(bounded.ops).toEqual(first.ops);
    expect(t.db.pendingCount()).toBeGreaterThan(first.ops.length);
  });
});
