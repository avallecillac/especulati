import { describe, expect, it } from 'vitest';
import type { Command } from '@especulati/lector-core';
import { migrate, LectorDb, SCHEMA_VERSION } from '../src/index.ts';
import { dumpLogical, emptyDb, DEVICE, uuid } from './helpers.ts';

const TABLES = ['items', 'reading_events', 'highlights', 'change_log', 'field_clock', 'duplicate_dismissals', 'sync_inbox', 'covers'];
const STATUS = { lastOkAt: '2026-09-27T12:00:00.000Z', problem: null, undecryptable: 3 };

function v4Fixture() {
  const raw = emptyDb();
  migrate(raw, { to: 4 });
  expect(raw.selectValue('PRAGMA user_version')).toBe(4);
  const db = new LectorDb(raw);
  db.ensureDeviceId(DEVICE);
  let wall = Date.UTC(2026, 8, 27, 12);
  let op = 0;
  const env = () => ({ now: new Date(wall).toISOString() as never, wallMs: () => wall, newOpId: () => uuid(0x900 + ++op) });
  const run = (cmd: Command) => {
    wall += 1000;
    expect(db.dispatch(cmd, env())).toMatchObject({ ok: true });
  };
  run({ kind: 'AddArticle', itemId: uuid(2), url: 'https://www.example.com/a', title: 'An article', author: null, wordCount: 500, readOn: '2026-09-02', detailsStatus: 'complete' });
  run({ kind: 'AddHighlight', highlightId: uuid(30), itemId: uuid(2), quote: 'A passage', localDate: '2026-09-02' });
  db.setMeta('sync_cursor', '57');
  db.setMeta('sync_status', JSON.stringify(STATUS));
  return raw;
}

describe('migration 5', () => {
  it('upgrades a v4 database: rows kept, tags and item_tags rebuilt with indexes, idx_items_saved added, cursor reset', () => {
    const raw = v4Fixture();
    const before = dumpLogical(raw, TABLES);
    migrate(raw);
    expect(SCHEMA_VERSION).toBe(5);
    expect(raw.selectValue('PRAGMA user_version')).toBe(5);
    expect(dumpLogical(raw, TABLES)).toEqual(before);
    expect(raw.selectValue('SELECT count(*) FROM items')).toBe(1);
    expect(raw.selectValue('SELECT count(*) FROM highlights')).toBe(1);
    const cols = (t: string) => raw.selectValues(`SELECT name FROM pragma_table_info('${t}')`).map(String);
    expect(cols('tags')).toEqual(['id', 'name', 'name_key', 'created_at', 'deleted_at']);
    expect(cols('item_tags')).toEqual(['id', 'item_id', 'tag_id', 'created_at', 'deleted_at']);
    const indexes = raw.selectValues("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").map(String);
    for (const i of ['idx_tags_key', 'idx_item_tags_item', 'idx_item_tags_tag', 'idx_items_saved']) expect(indexes).toContain(i);
    expect(raw.selectValue("SELECT value FROM meta WHERE key='sync_cursor'")).toBe('0');
    expect(JSON.parse(raw.selectValue("SELECT value FROM meta WHERE key='sync_status'") as string)).toEqual({ ...STATUS, undecryptable: 0 });
  });

  it('the new tables enforce their checks', () => {
    const raw = v4Fixture();
    migrate(raw);
    expect(() => raw.exec("INSERT INTO tags (id, name, name_key, created_at) VALUES ('t1', '', '', 'x')")).toThrow();
    expect(() => raw.exec(`INSERT INTO tags (id, name, name_key, created_at) VALUES ('t1', '${'x'.repeat(41)}', 'x', 'x')`)).toThrow();
    expect(() => raw.exec("INSERT INTO item_tags (id, item_id, tag_id, created_at) VALUES ('i1', 'nope', 'nope', 'x')")).toThrow();
  });

  it('is a no-op when run again', () => {
    const raw = v4Fixture();
    migrate(raw);
    const before = dumpLogical(raw, [...TABLES, 'meta', 'tags', 'item_tags']);
    migrate(raw);
    expect(raw.selectValue('PRAGMA user_version')).toBe(5);
    expect(dumpLogical(raw, [...TABLES, 'meta', 'tags', 'item_tags'])).toEqual(before);
  });
});
