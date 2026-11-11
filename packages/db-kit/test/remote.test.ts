import { describe, expect, it } from 'vitest';
import { applyRemoteOps } from '../src/index.ts';
import { DEVICE, REMOTE, T0, h, op, openToyDb, toyCanInsert, toySchema, uuid } from './helpers.ts';

const wall = () => T0 + 5000;
const apply = (raw: ReturnType<typeof openToyDb>, ops: Parameters<typeof applyRemoteOps<'notes' | 'marks'>>[3]) =>
  applyRemoteOps(raw, toySchema, toyCanInsert, ops, DEVICE, wall);

describe('applyRemoteOps', () => {
  it('inserts, sets field_clock per field and logs the op as pushed', () => {
    const raw = openToyDb();
    const o = op('notes', uuid(1), { body: 'hi' }, h(T0));
    expect(apply(raw, [o])).toEqual({ applied: 1, skipped: 0, parked: 0 });
    expect(raw.selectObjects('SELECT body FROM notes')).toEqual([{ body: 'hi' }]);
    expect(raw.selectObjects('SELECT field, hlc FROM field_clock')).toEqual([{ field: 'body', hlc: o.hlc }]);
    expect(raw.selectObjects('SELECT op_id, device_id, pushed FROM change_log')).toEqual([{ op_id: o.opId, device_id: REMOTE, pushed: 1 }]);
  });

  it('skips a duplicate op_id', () => {
    const raw = openToyDb();
    const o = op('notes', uuid(1), { body: 'hi' }, h(T0));
    apply(raw, [o]);
    expect(apply(raw, [o])).toEqual({ applied: 0, skipped: 1, parked: 0 });
    expect(raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(1);
  });

  it('resolves last-writer-wins per field; the loser is still logged', () => {
    const raw = openToyDb();
    apply(raw, [op('notes', uuid(1), { body: 'new' }, h(T0 + 10))]);
    const stale = op('notes', uuid(1), { body: 'old', deleted_at: 'd' }, h(T0));
    apply(raw, [stale]);
    expect(raw.selectObjects('SELECT body, deleted_at FROM notes')).toEqual([{ body: 'new', deleted_at: 'd' }]);
    expect(raw.selectValue('SELECT COUNT(*) FROM change_log WHERE op_id = ?', [stale.opId])).toBe(1);
  });

  it('breaks an HLC tie on the device id', () => {
    const a = uuid(0xaaaa);
    const b = uuid(0xbbbb);
    const x = op('notes', uuid(1), { body: 'from-a' }, h(T0, 0, a));
    const y = op('notes', uuid(1), { body: 'from-b' }, h(T0, 0, b));
    const r1 = openToyDb();
    apply(r1, [x, y]);
    const r2 = openToyDb();
    apply(r2, [y, x]);
    expect(r1.selectValue('SELECT body FROM notes')).toBe('from-b');
    expect(r2.selectValue('SELECT body FROM notes')).toBe('from-b');
  });

  it('parks a child whose parent is missing, then drains it when the parent arrives', () => {
    const raw = openToyDb();
    const mark = op('marks', uuid(2), { note_id: uuid(1), label: 'm' }, h(T0 + 1));
    expect(apply(raw, [mark])).toEqual({ applied: 0, skipped: 0, parked: 1 });
    expect(raw.selectValue('SELECT COUNT(*) FROM sync_inbox')).toBe(1);
    expect(raw.selectValue('SELECT COUNT(*) FROM marks')).toBe(0);
    expect(raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(0);

    expect(apply(raw, [op('notes', uuid(1), { body: 'n' }, h(T0))])).toEqual({ applied: 2, skipped: 0, parked: 0 });
    expect(raw.selectValue('SELECT COUNT(*) FROM sync_inbox')).toBe(0);
    expect(raw.selectObjects('SELECT label FROM marks')).toEqual([{ label: 'm' }]);
  });

  it('parks an insert that lacks its insert-required fields', () => {
    const raw = openToyDb();
    expect(apply(raw, [op('notes', uuid(1), { deleted_at: 'x' }, h(T0))]).parked).toBe(1);
    expect(raw.selectValue('SELECT COUNT(*) FROM notes')).toBe(0);
  });

  it('is all or nothing: a corrupt inbox row rolls the whole page back', () => {
    const raw = openToyDb();
    raw.exec("INSERT INTO sync_inbox (op_id, hlc, device_id, tbl, row_id, fields_json) VALUES (?, ?, ?, 'nope', ?, '{}')", {
      bind: [uuid(9), h(T0), REMOTE, uuid(9)],
    });
    expect(() => apply(raw, [op('notes', uuid(1), { body: 'hi' }, h(T0))])).toThrow('corrupt sync_inbox row');
    expect(raw.selectValue('SELECT COUNT(*) FROM notes')).toBe(0);
    expect(raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(0);
    expect(raw.selectValue('SELECT COUNT(*) FROM sync_inbox')).toBe(1);
  });

  it('advances the local hlc past a remote op', () => {
    const raw = openToyDb();
    const o = op('notes', uuid(1), { body: 'hi' }, h(T0 + 99_000));
    apply(raw, [o]);
    expect((raw.selectValue("SELECT value FROM meta WHERE key = 'hlc'") as string) > o.hlc).toBe(true);
  });
});
