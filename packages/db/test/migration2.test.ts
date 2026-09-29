import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { applyChanges, migrate, ReaderlogDb, SCHEMA_VERSION } from '../src/index.ts';
import { dumpLogical, emptyDb, DEVICE, uuid } from './helpers.ts';

const TABLES = ['items', 'reading_events', 'change_log', 'field_clock'];

function v1Fixture() {
  const raw = emptyDb();
  migrate(raw, { to: 1 });
  expect(raw.selectValue('PRAGMA user_version')).toBe(1);
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
  return raw;
}

describe('migration 2', () => {
  it('upgrades a v1 database with data, changing nothing but adding the new objects', () => {
    const raw = v1Fixture();
    const before = dumpLogical(raw, TABLES);
    migrate(raw, { to: 2 });
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    expect(raw.selectValue('PRAGMA user_version')).toBe(2);
    expect(dumpLogical(raw, TABLES)).toEqual(before);
    const names = raw.selectArrays(`SELECT name FROM sqlite_schema WHERE name IN ('idx_items_isbn','covers')`).map((r) => r[0]).sort();
    expect(names).toEqual(['covers', 'idx_items_isbn']);
  });

  it('is a no-op when run again', () => {
    const raw = v1Fixture();
    migrate(raw, { to: 2 });
    const before = dumpLogical(raw, TABLES);
    migrate(raw, { to: 2 });
    expect(raw.selectValue('PRAGMA user_version')).toBe(2);
    expect(dumpLogical(raw, TABLES)).toEqual(before);
  });

  it('applyChanges rejects the covers table', () => {
    const raw = emptyDb();
    migrate(raw);
    expect(() =>
      applyChanges(raw, [{ tbl: 'covers', rowId: uuid(1), fields: { mime: 'image/jpeg' } }] as never, DEVICE, () => 1, () => uuid(9)),
    ).toThrow(/table/);
  });
});
