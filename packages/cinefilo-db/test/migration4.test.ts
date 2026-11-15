import { describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION } from '../src/index.ts';
import { ANA, emptyDb, hashId, uuid } from './helpers.ts';

const STATUS = { lastOkAt: '2026-10-27T12:00:00.000Z', problem: null, undecryptable: 3 };
const cols = (raw: ReturnType<typeof emptyDb>, t: string): string[] => raw.selectValues(`SELECT name FROM pragma_table_info('${t}')`).map(String);

/** A schema v3 database as an installed device holds it: titles with genres, a change log, a cursor and a skipped-batch count. */
function v3Fixture() {
  const raw = emptyDb();
  migrate(raw, { to: 3 });
  expect(raw.selectValue('PRAGMA user_version')).toBe(3);
  const T1 = hashId('t1');
  raw.exec(`INSERT INTO titles (id, kind, title, tmdb_id, genres, status, added_by, created_at) VALUES ('${T1}', 'movie', 'Stalker', 1398, '["Sci-Fi"]', 'watched', '${ANA}', 'c')`);
  raw.exec(`INSERT INTO field_clock (tbl, row_id, field, hlc) VALUES ('titles', '${T1}', 'genres', '0000000000001-0000-${uuid(1)}')`);
  raw.exec(`INSERT INTO meta (key, value) VALUES ('sync_cursor', '120'), ('sync_status', '${JSON.stringify(STATUS)}'), ('tmdb_key', 'K')`);
  return { raw, T1 };
}

describe('migration 4 (cinefilo-tmdb-credits D1)', () => {
  it('upgrades v3 to v4: four nullable columns added as NULL, every other value kept', () => {
    const { raw, T1 } = v3Fixture();
    const before = raw.selectArrays('SELECT id, kind, title, tmdb_id, genres, status, added_by, created_at FROM titles');
    migrate(raw);
    expect(SCHEMA_VERSION).toBe(4);
    expect(raw.selectValue('PRAGMA user_version')).toBe(4);
    for (const c of ['countries', 'directors', 'lead_actor', 'lead_actress']) expect(cols(raw, 'titles'), c).toContain(c);
    expect(raw.selectArrays('SELECT id, kind, title, tmdb_id, genres, status, added_by, created_at FROM titles')).toEqual(before);
    expect(raw.selectArrays('SELECT countries, directors, lead_actor, lead_actress FROM titles WHERE id = ?', [T1])).toEqual([[null, null, null, null]]);
    expect(raw.selectValue('SELECT COUNT(*) FROM field_clock')).toBe(1);
  });

  it('resets the sync cursor and the skipped-batch counter, and keeps the rest of meta', () => {
    const { raw } = v3Fixture();
    migrate(raw);
    expect(raw.selectValue("SELECT value FROM meta WHERE key = 'sync_cursor'")).toBe('0');
    expect(JSON.parse(raw.selectValue("SELECT value FROM meta WHERE key = 'sync_status'") as string)).toEqual({ ...STATUS, undecryptable: 0 });
    expect(raw.selectValue("SELECT value FROM meta WHERE key = 'tmdb_key'")).toBe('K');
  });

  it('a database already at v4 is not reset again', () => {
    const { raw } = v3Fixture();
    migrate(raw);
    raw.exec("UPDATE meta SET value = '40' WHERE key = 'sync_cursor'");
    migrate(raw);
    expect(raw.selectValue("SELECT value FROM meta WHERE key = 'sync_cursor'")).toBe('40');
  });

  it('a fresh database reaches the same schema as an upgraded one', () => {
    const { raw } = v3Fixture();
    migrate(raw);
    const fresh = emptyDb();
    migrate(fresh);
    const names = (r: ReturnType<typeof emptyDb>) => r.selectValues("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name");
    expect(cols(fresh, 'titles')).toEqual(cols(raw, 'titles'));
    expect(names(raw)).toEqual(names(fresh));
  });
});
