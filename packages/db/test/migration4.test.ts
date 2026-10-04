import { describe, expect, it } from 'vitest';
import type { Command } from '@readerlog/core';
import { migrate, ReaderlogDb, SCHEMA_VERSION } from '../src/index.ts';
import { dumpLogical, emptyDb, DEVICE, uuid } from './helpers.ts';

const TABLES = ['items', 'reading_events', 'change_log', 'field_clock', 'duplicate_dismissals', 'sync_inbox', 'covers'];
const STATUS = { lastOkAt: '2026-09-27T12:00:00.000Z', problem: null, undecryptable: 3 };

function v3Fixture() {
  const raw = emptyDb();
  migrate(raw, { to: 3 });
  expect(raw.selectValue('PRAGMA user_version')).toBe(3);
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
  run({ kind: 'AddArticle', itemId: uuid(2), url: 'https://www.example.com/a', title: 'An article', author: null, wordCount: 500, readOn: '2026-09-02', detailsStatus: 'complete' });
  run({ kind: 'LogEvent', itemId: uuid(1), eventId: uuid(201), type: 'progress', page: 10, localDate: '2026-09-03' });
  db.setMeta('sync_cursor', '57');
  db.setMeta('sync_status', JSON.stringify(STATUS));
  return raw;
}

describe('migration 4', () => {
  it('upgrades a v3 database: rows kept, highlights table and index added, cursor reset, undecryptable cleared', () => {
    const raw = v3Fixture();
    const before = dumpLogical(raw, TABLES);
    migrate(raw);
    expect(SCHEMA_VERSION).toBe(4);
    expect(raw.selectValue('PRAGMA user_version')).toBe(4);
    expect(dumpLogical(raw, TABLES)).toEqual(before);
    expect(raw.selectValue('SELECT count(*) FROM items')).toBe(2);
    expect(raw.selectValue("SELECT name FROM sqlite_master WHERE type='table' AND name='highlights'")).toBe('highlights');
    expect(raw.selectValue("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_highlights_item'")).toBe('idx_highlights_item');
    expect(raw.selectValue('SELECT count(*) FROM highlights')).toBe(0);
    expect(raw.selectValue("SELECT value FROM meta WHERE key='sync_cursor'")).toBe('0');
    expect(JSON.parse(raw.selectValue("SELECT value FROM meta WHERE key='sync_status'") as string)).toEqual({ ...STATUS, undecryptable: 0 });
  });

  it('leaves a database without sync meta alone (no cursor or status rows are invented)', () => {
    const raw = emptyDb();
    migrate(raw, { to: 3 });
    migrate(raw);
    expect(raw.selectValue("SELECT count(*) FROM meta WHERE key IN ('sync_cursor','sync_status')")).toBe(0);
  });

  it('is a no-op when run again', () => {
    const raw = v3Fixture();
    migrate(raw);
    const before = dumpLogical(raw, [...TABLES, 'meta', 'highlights']);
    migrate(raw);
    expect(raw.selectValue('PRAGMA user_version')).toBe(4);
    expect(dumpLogical(raw, [...TABLES, 'meta', 'highlights'])).toEqual(before);
  });
});
