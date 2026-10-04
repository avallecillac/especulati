import { describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION } from '../src/index.ts';
import { emptyDb } from './helpers.ts';

const names = (raw: ReturnType<typeof emptyDb>, type: string) =>
  raw.selectArrays(`SELECT name FROM sqlite_schema WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, [type]).map((r) => r[0]);

describe('migration 1', () => {
  it('reaches user_version 1 with every table and index from contracts/db-schema.md', () => {
    const raw = emptyDb();
    migrate(raw, { to: 1 });
    expect(SCHEMA_VERSION).toBe(4);
    expect(raw.selectValue('PRAGMA user_version')).toBe(1);
    expect(names(raw, 'table')).toEqual(['change_log', 'field_clock', 'item_tags', 'items', 'meta', 'reading_events', 'tags']);
    expect(names(raw, 'index')).toEqual(['idx_changelog_unpushed', 'idx_events_date', 'idx_events_item_date', 'idx_items_type_read']);
  });

  it('is a no-op when run twice', () => {
    const raw = emptyDb();
    migrate(raw);
    raw.exec(`INSERT INTO meta VALUES ('k','v')`);
    migrate(raw);
    expect(raw.selectValue(`SELECT value FROM meta WHERE key='k'`)).toBe('v');
    expect(raw.selectValue('PRAGMA user_version')).toBe(SCHEMA_VERSION);
  });

  it('enables foreign keys', () => {
    const raw = emptyDb();
    migrate(raw);
    expect(raw.selectValue('PRAGMA foreign_keys')).toBe(1);
  });

  describe('CHECK constraints (second line of defense)', () => {
    const raw = emptyDb();
    migrate(raw);
    const insertItem = (title: string, pages: number | null) =>
      raw.exec(`INSERT INTO items (id, type, title, total_pages, created_at) VALUES (lower(hex(randomblob(16))), 'book', ?, ?, '2026-01-01T00:00:00.000Z')`, { bind: [title, pages] });

    it('rejects a blank title', () => expect(() => insertItem('   ', null)).toThrow(/CHECK/));
    it('rejects total_pages = 0', () => expect(() => insertItem('Dune', 0)).toThrow(/CHECK/));
    it('rejects a page on a non-progress event', () => {
      raw.exec(`INSERT INTO items (id, type, title, created_at) VALUES ('i1', 'book', 'Dune', '2026-01-01T00:00:00.000Z')`);
      expect(() =>
        raw.exec(`INSERT INTO reading_events (id, item_id, event_type, page, occurred_at, local_date) VALUES ('e1','i1','started',5,'2026-01-01T00:00:00.000Z','2026-01-01')`),
      ).toThrow(/CHECK/);
    });
    it('rejects a malformed local_date', () =>
      expect(() =>
        raw.exec(`INSERT INTO reading_events (id, item_id, event_type, occurred_at, local_date) VALUES ('e2','i1','started','2026-01-01T00:00:00.000Z','2026/01/01')`),
      ).toThrow(/CHECK/));
  });
});
