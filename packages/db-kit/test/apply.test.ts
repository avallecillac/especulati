import { describe, expect, it } from 'vitest';
import { applyChanges, readMeta, upsertRow } from '../src/index.ts';
import { DEVICE, openToyDb, toySchema, uuid } from './helpers.ts';

let n = 0;
const newOpId = () => uuid(0x100 + ++n);
const wall = () => Date.UTC(2026, 8, 27, 12, 0, 0);

describe('upsertRow', () => {
  it('inserts, then updates only the given fields', () => {
    const raw = openToyDb();
    upsertRow(raw, toySchema, { tbl: 'notes', rowId: uuid(1), fields: { body: 'a' } });
    upsertRow(raw, toySchema, { tbl: 'notes', rowId: uuid(1), fields: { deleted_at: 'x' } });
    expect(raw.selectObjects('SELECT body, deleted_at FROM notes')).toEqual([{ body: 'a', deleted_at: 'x' }]);
  });

  it('rejects an unknown table or column before touching SQL', () => {
    const raw = openToyDb();
    expect(() => upsertRow(raw, toySchema, { tbl: 'nope' as 'notes', rowId: uuid(1), fields: {} })).toThrow('unknown table');
    expect(() => upsertRow(raw, toySchema, { tbl: 'notes', rowId: uuid(1), fields: { id: 'x' } })).toThrow('unknown column');
    expect(() => upsertRow(raw, toySchema, { tbl: 'notes', rowId: uuid(1), fields: { 'body) VALUES (1); --': 'x' } })).toThrow('unknown column');
  });
});

describe('applyChanges', () => {
  it('writes rows, field_clock, change_log and meta.hlc together, one HLC per change', () => {
    const raw = openToyDb();
    applyChanges(raw, toySchema, [
      { tbl: 'notes', rowId: uuid(1), fields: { body: 'a' } },
      { tbl: 'notes', rowId: uuid(2), fields: { body: 'b' } },
    ], DEVICE, wall, newOpId);
    expect(raw.selectValue('SELECT COUNT(*) FROM notes')).toBe(2);
    expect(raw.selectValue('SELECT COUNT(*) FROM field_clock')).toBe(2);
    const log = raw.selectObjects('SELECT hlc, pushed FROM change_log ORDER BY seq');
    expect(log).toHaveLength(2);
    expect(log[0]!.hlc).not.toBe(log[1]!.hlc);
    expect(log.every((r) => r.pushed === 0)).toBe(true);
    expect(readMeta(raw, 'hlc')).toBe(log[1]!.hlc);
  });

  it('is atomic: a bad change in the middle leaves nothing behind', () => {
    const raw = openToyDb();
    expect(() => applyChanges(raw, toySchema, [
      { tbl: 'notes', rowId: uuid(1), fields: { body: 'a' } },
      { tbl: 'notes', rowId: uuid(2), fields: { nope: 'b' } },
    ], DEVICE, wall, newOpId)).toThrow('unknown column');
    for (const t of ['notes', 'field_clock', 'change_log']) expect(raw.selectValue(`SELECT COUNT(*) FROM ${t}`)).toBe(0);
    expect(readMeta(raw, 'hlc')).toBeNull();
  });
});
