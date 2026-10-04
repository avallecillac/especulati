import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { migrate, ReaderlogDb } from '../src/index.ts';
import { dumpLogical, emptyDb, DEVICE, uuid } from './helpers.ts';

const TABLES = ['items', 'reading_events', 'change_log', 'field_clock', 'meta'];

function v2Fixture() {
  const raw = emptyDb();
  migrate(raw, { to: 2 });
  expect(raw.selectValue('PRAGMA user_version')).toBe(2);
  const db = new ReaderlogDb(raw);
  db.ensureDeviceId(DEVICE);
  let wall = Date.UTC(2026, 8, 27, 12);
  let op = 0;
  const env = () => ({ now: new Date(wall).toISOString() as never, wallMs: () => wall, newOpId: () => uuid(0x900 + ++op) });
  const run = (cmd: Command) => {
    wall += 1000;
    expect(db.dispatch(cmd, env())).toMatchObject({ ok: true });
  };
  run({ kind: 'AddBook', itemId: uuid(1), title: 'Dune', startNow: true, startEventId: uuid(101), localDate: '2026-09-01' });
  run({ kind: 'AddBook', itemId: uuid(2), title: 'Emma', startNow: false, localDate: '2026-09-02' });
  run({ kind: 'LogEvent', itemId: uuid(1), eventId: uuid(201), type: 'progress', page: 10, localDate: '2026-09-03' });
  db.putCover(uuid(1), new Uint8Array([1, 2, 3]), 100, 150, '2026-09-03T00:00:00.000Z');
  return raw;
}

const cols = (raw: ReturnType<typeof emptyDb>, t: string) =>
  raw.selectArrays(`SELECT name, type, "notnull", pk FROM pragma_table_info('${t}')`).map((r) => r.map(String).join(':'));

describe('migration 3', () => {
  it('upgrades a v2 database, leaving rows and covers unchanged', () => {
    const raw = v2Fixture();
    const before = dumpLogical(raw, TABLES);
    const covers = dumpLogical(raw, ['covers']);
    migrate(raw, { to: 3 });
    expect(raw.selectValue('PRAGMA user_version')).toBe(3);
    // items gained a column, so compare through the new column being null everywhere.
    expect(raw.selectValue('SELECT count(*) FROM items WHERE merged_into IS NOT NULL')).toBe(0);
    const after = dumpLogical(raw, TABLES.filter((t) => t !== 'items'));
    expect(after).toEqual(Object.fromEntries(Object.entries(before).filter(([t]) => t !== 'items')));
    expect(raw.selectValue('SELECT count(*) FROM items')).toBe(2);
    expect(dumpLogical(raw, ['covers'])).toEqual(covers);
  });

  it('creates duplicate_dismissals, sync_inbox and items.merged_into as in data-model.md', () => {
    const raw = emptyDb();
    migrate(raw);
    expect(cols(raw, 'duplicate_dismissals')).toEqual([
      'id:TEXT:0:1', 'item_a:TEXT:1:0', 'item_b:TEXT:1:0', 'created_at:TEXT:1:0', 'deleted_at:TEXT:0:0',
    ]);
    expect(cols(raw, 'sync_inbox')).toEqual([
      'op_id:TEXT:0:1', 'hlc:TEXT:1:0', 'device_id:TEXT:1:0', 'tbl:TEXT:1:0', 'row_id:TEXT:1:0', 'fields_json:TEXT:1:0',
    ]);
    expect(cols(raw, 'items').at(-1)).toBe('merged_into:TEXT:0:0');
  });

  it('is a no-op when run again', () => {
    const raw = v2Fixture();
    migrate(raw, { to: 3 });
    const before = dumpLogical(raw, TABLES);
    migrate(raw, { to: 3 });
    expect(raw.selectValue('PRAGMA user_version')).toBe(3);
    expect(dumpLogical(raw, TABLES)).toEqual(before);
  });
});
