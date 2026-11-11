import { describe, expect, it } from 'vitest';
import { stampOps, type Change, type Hlc } from '@especulati/lector-core';
import { applyChanges, readMeta } from '../src/index.ts';
import { DEVICE, openTestDb, uuid } from './helpers.ts';

const changes: Change[] = [
  { tbl: 'items', rowId: uuid(1), fields: { type: 'article', title: 'A', author: null, url: 'https://e.com/', domain: 'e.com', word_count: 10, read_on: '2026-09-27', metadata_status: 'ok', created_at: '2026-09-27T12:00:00.000Z' } },
  { tbl: 'items', rowId: uuid(1), fields: { title: 'B' } },
  { tbl: 'duplicate_dismissals', rowId: uuid(2), fields: { item_a: uuid(3), item_b: uuid(4), created_at: '2026-09-27T12:00:00.000Z' } },
];

describe('stampOps matches applyChanges', () => {
  it.each([
    ['a fresh clock', false],
    ['an existing clock', true],
  ])('same (tbl,row,fields,hlc) sequence with %s', (_n, seeded) => {
    const t = openTestDb();
    const wall = Date.UTC(2026, 8, 27, 12, 0, 0);
    if (seeded) {
      // an earlier local write leaves meta.hlc behind
      applyChanges(t.raw, [{ tbl: 'duplicate_dismissals', rowId: uuid(9), fields: { item_a: uuid(5), item_b: uuid(6), created_at: 'x' } }], DEVICE, () => wall, () => uuid(0x900));
    }
    const prev = readMeta(t.raw, 'hlc') as Hlc | null;
    const before = Number(t.raw.selectValue('SELECT COUNT(*) FROM change_log'));

    let n = 0;
    const stamped = stampOps(changes, { hlc: prev, deviceId: DEVICE, wallMs: wall, newOpId: () => uuid(0x100 + ++n) });
    applyChanges(t.raw, changes, DEVICE, () => wall, () => uuid(0x200 + ++n));

    const logged = t.raw
      .selectObjects('SELECT tbl, row_id, fields_json, hlc FROM change_log ORDER BY seq')
      .slice(before)
      .map((r) => ({ tbl: r['tbl'], row: r['row_id'], fields: JSON.parse(r['fields_json'] as string), hlc: r['hlc'] }));
    expect(stamped.ops.map(({ tbl, row, fields, hlc }) => ({ tbl, row, fields, hlc }))).toEqual(logged);
    expect(stamped.hlc).toBe(readMeta(t.raw, 'hlc'));
  });
});
