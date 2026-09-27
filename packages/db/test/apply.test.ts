import { describe, expect, it } from 'vitest';
import type { Change } from '@readerlog/core';
import { applyChanges } from '../src/index.ts';
import { DEVICE, dumpLogical, openTestDb, uuid } from './helpers.ts';

const book = (n: number, title = `Book ${n}`): Change => ({
  tbl: 'items',
  rowId: uuid(n),
  fields: { type: 'book', title, created_at: '2026-09-27T12:00:00.000Z' },
});
const started = (n: number, item: number): Change => ({
  tbl: 'reading_events',
  rowId: uuid(100 + n),
  fields: { item_id: uuid(item), event_type: 'started', page: null, occurred_at: '2026-09-27T12:00:00.000Z', local_date: '2026-09-27' },
});

describe('applyChanges (contracts/db-schema.md "Tested invariants")', () => {
  it('1. adds exactly one change_log row per change', () => {
    const t = openTestDb();
    applyChanges(t.raw, [book(1), started(1, 1), book(2)], DEVICE, t.env.wallMs, t.env.newOpId);
    expect(t.raw.selectValue('SELECT count(*) FROM change_log')).toBe(3);
  });

  it('2. field_clock has every (tbl,row,field) of a change at that change\'s hlc', () => {
    const t = openTestDb();
    const changes = [book(1), started(1, 1)];
    applyChanges(t.raw, changes, DEVICE, t.env.wallMs, t.env.newOpId);
    const log = t.raw.selectObjects('SELECT hlc, tbl, row_id, fields_json FROM change_log ORDER BY seq');
    for (const entry of log) {
      for (const field of Object.keys(JSON.parse(entry['fields_json'] as string) as object)) {
        const hlc = t.raw.selectValue('SELECT hlc FROM field_clock WHERE tbl=? AND row_id=? AND field=?', [entry['tbl']!, entry['row_id']!, field]);
        expect(hlc).toBe(entry['hlc']);
      }
    }
  });

  it('3. hlc strictly increases in seq order, even with a frozen wall clock', () => {
    const t = openTestDb();
    applyChanges(t.raw, [book(1), book(2), book(3)], DEVICE, t.env.wallMs, t.env.newOpId);
    applyChanges(t.raw, [book(4)], DEVICE, t.env.wallMs, t.env.newOpId);
    const hlcs = t.raw.selectArrays('SELECT hlc FROM change_log ORDER BY seq').map((r) => r[0] as string);
    expect(hlcs).toEqual([...hlcs].sort());
    expect(new Set(hlcs).size).toBe(hlcs.length);
    expect(t.raw.selectValue(`SELECT value FROM meta WHERE key='hlc'`)).toBe(hlcs.at(-1));
  });

  it('4. a failure after change k leaves the database logically identical', () => {
    const t = openTestDb();
    applyChanges(t.raw, [book(1)], DEVICE, t.env.wallMs, t.env.newOpId);
    const before = dumpLogical(t.raw);
    const poisoned: Change = { tbl: 'items', rowId: uuid(3), fields: { type: 'book', title: '   ', created_at: '2026-09-27T12:00:00.000Z' } };
    expect(() => applyChanges(t.raw, [book(2), started(2, 2), poisoned], DEVICE, t.env.wallMs, t.env.newOpId)).toThrow();
    expect(dumpLogical(t.raw)).toEqual(before);
  });

  it('updates only the fields present in a change', () => {
    const t = openTestDb();
    applyChanges(t.raw, [{ ...book(1), fields: { ...book(1).fields, author: 'Herbert' } }], DEVICE, t.env.wallMs, t.env.newOpId);
    applyChanges(t.raw, [{ tbl: 'items', rowId: uuid(1), fields: { title: 'Dune' } }], DEVICE, t.env.wallMs, t.env.newOpId);
    expect(t.raw.selectObject('SELECT title, author FROM items WHERE id=?', [uuid(1)])).toEqual({ title: 'Dune', author: 'Herbert' });
  });

  it('rejects unknown tables and columns instead of interpolating them into SQL', () => {
    const t = openTestDb();
    const before = dumpLogical(t.raw);
    expect(() => applyChanges(t.raw, [{ tbl: 'items', rowId: uuid(1), fields: { 'title; DROP TABLE items': 'x' } }], DEVICE, t.env.wallMs, t.env.newOpId)).toThrow(/column/);
    expect(() => applyChanges(t.raw, [{ tbl: 'meta' as Change['tbl'], rowId: 'k', fields: { value: 'x' } }], DEVICE, t.env.wallMs, t.env.newOpId)).toThrow(/table/);
    expect(dumpLogical(t.raw)).toEqual(before);
  });
});

describe('storage failure (spec edge case, T065)', () => {
  it('SQLITE_FULL during dispatch rolls back everything and surfaces the error', () => {
    const t = openTestDb();
    // Cap the database at its current size, then write until a dispatch needs a new page.
    t.raw.exec(`PRAGMA max_page_count = ${Number(t.raw.selectValue('PRAGMA page_count'))}`);
    const long = 'x'.repeat(200);
    let before = dumpLogical(t.raw);
    let failure: unknown = null;
    for (let i = 0; i < 1000 && failure === null; i++) {
      before = dumpLogical(t.raw);
      t.tick();
      try {
        t.db.dispatch({ kind: 'AddBook', itemId: uuid(100 + i), title: long, author: long, genre: long, startNow: true, startEventId: uuid(5000 + i), localDate: '2026-09-27' }, t.env);
      } catch (e) {
        failure = e;
      }
    }
    expect(String(failure)).toMatch(/SQLITE_FULL/);
    expect(dumpLogical(t.raw)).toEqual(before);
  });
});
