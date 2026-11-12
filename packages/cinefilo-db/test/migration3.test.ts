import { describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION } from '../src/index.ts';
import { ANA, BEN, emptyDb, hashId, ratingIdOf, uuid } from './helpers.ts';

const STATUS = { lastOkAt: '2026-09-27T12:00:00.000Z', problem: null, undecryptable: 2 };
const cols = (raw: ReturnType<typeof emptyDb>, t: string): string[] => raw.selectValues(`SELECT name FROM pragma_table_info('${t}')`).map(String);

/** A schema v2 database as an installed device holds it: ratings with verdicts, a change log, a cursor and a skipped-batch count. */
function v2Fixture() {
  const raw = emptyDb();
  migrate(raw, { to: 2 });
  expect(raw.selectValue('PRAGMA user_version')).toBe(2);
  const T1 = hashId('t1');
  raw.exec(`INSERT INTO titles (id, kind, title, status, added_by, created_at) VALUES ('${T1}', 'movie', 'Stalker', 'watched', '${ANA}', 'c')`);
  raw.exec(`INSERT INTO ratings (id, title_id, member_id, verdict, review, updated_at) VALUES
    ('${ratingIdOf(T1, ANA)}', '${T1}', '${ANA}', 'like', 'great', 'x'), ('${ratingIdOf(T1, BEN)}', '${T1}', '${BEN}', 'dislike', NULL, 'x')`);
  raw.exec(`INSERT INTO field_clock (tbl, row_id, field, hlc) VALUES ('ratings', '${ratingIdOf(T1, ANA)}', 'verdict', '0000000000001-0000-${uuid(1)}')`);
  raw.exec(`INSERT INTO meta (key, value) VALUES ('sync_cursor', '81'), ('sync_status', '${JSON.stringify(STATUS)}'), ('tmdb_key', 'K')`);
  return { raw, T1 };
}

describe('migration 3 (cinefilo-stars D1)', () => {
  it('upgrades v2 to v3: ratings.stars added as NULL, every other value kept', () => {
    const { raw } = v2Fixture();
    const before = raw.selectArrays('SELECT id, title_id, member_id, verdict, review, updated_at, deleted_at FROM ratings ORDER BY id');
    migrate(raw);
    expect(SCHEMA_VERSION).toBe(3);
    expect(raw.selectValue('PRAGMA user_version')).toBe(3);
    expect(cols(raw, 'ratings')).toContain('stars');
    expect(raw.selectArrays('SELECT id, title_id, member_id, verdict, review, updated_at, deleted_at FROM ratings ORDER BY id')).toEqual(before);
    expect(raw.selectValues('SELECT stars FROM ratings')).toEqual([null, null]);
    expect(raw.selectValue('SELECT COUNT(*) FROM field_clock')).toBe(1);
  });

  it('the CHECK accepts NULL and 1..10, and refuses anything else', () => {
    const raw = emptyDb();
    migrate(raw);
    const add = (stars: string) => raw.exec(`INSERT INTO ratings (id, title_id, member_id, stars, updated_at) VALUES ('${uuid(Math.floor(Math.random() * 1e9))}', 't', 'm', ${stars}, 'u')`);
    for (const ok of ['NULL', '1', '5', '10']) expect(() => add(ok), ok).not.toThrow();
    for (const bad of ['0', '11', '-1']) expect(() => add(bad), bad).toThrow();
  });

  it('resets the sync cursor and the skipped-batch counter, and keeps the rest of meta', () => {
    const { raw } = v2Fixture();
    migrate(raw);
    expect(raw.selectValue("SELECT value FROM meta WHERE key = 'sync_cursor'")).toBe('0');
    expect(JSON.parse(raw.selectValue("SELECT value FROM meta WHERE key = 'sync_status'") as string)).toEqual({ ...STATUS, undecryptable: 0 });
    expect(raw.selectValue("SELECT value FROM meta WHERE key = 'tmdb_key'")).toBe('K');
  });

  it('a database already at v3 is not reset again', () => {
    const { raw } = v2Fixture();
    migrate(raw);
    raw.exec("UPDATE meta SET value = '40' WHERE key = 'sync_cursor'");
    migrate(raw);
    expect(raw.selectValue("SELECT value FROM meta WHERE key = 'sync_cursor'")).toBe('40');
  });

  it('a fresh database reaches the same schema as an upgraded one', () => {
    const { raw } = v2Fixture();
    migrate(raw);
    const fresh = emptyDb();
    migrate(fresh);
    const names = (r: ReturnType<typeof emptyDb>) => r.selectValues("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name");
    expect(cols(fresh, 'ratings')).toEqual(cols(raw, 'ratings'));
    expect(names(raw)).toEqual(names(fresh));
  });
});
