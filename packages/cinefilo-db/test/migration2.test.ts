import { describe, expect, it } from 'vitest';
import { CinefiloDb, migrate, SCHEMA_VERSION } from '../src/index.ts';
import { ANA, BEN, emptyDb, hashId, ratingIdOf, uuid } from './helpers.ts';

const STATUS = { lastOkAt: '2026-09-27T12:00:00.000Z', problem: null, undecryptable: 3 };
const names = (raw: ReturnType<typeof emptyDb>, type: string): string[] =>
  raw.selectValues(`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, [type]).map(String);

/** A schema v1 database with the data an installed device holds: titles, ratings, change log, field clocks and a sync cursor. */
function v1Fixture() {
  const raw = emptyDb();
  migrate(raw, { to: 1 });
  expect(raw.selectValue('PRAGMA user_version')).toBe(1);
  const T1 = hashId('t1');
  const T2 = hashId('t2');
  raw.exec(`INSERT INTO titles (id, kind, title, status, watched_on, current_season, added_by, created_at, tmdb_id, genres)
    VALUES ('${T1}', 'movie', 'Stalker', 'watched', '2026-09-20', NULL, '${ANA}', '2026-09-01T10:00:00.000Z', 1398, '["Drama"]'),
           ('${T2}', 'series', 'Severance', 'watching', NULL, 2, '${BEN}', '2026-09-02T10:00:00.000Z', NULL, NULL)`);
  raw.exec(`INSERT INTO members (id, name, created_at) VALUES ('${ANA}', 'Ana', 'x'), ('${BEN}', 'Ben', 'x')`);
  raw.exec(`INSERT INTO ratings (id, title_id, member_id, verdict, updated_at) VALUES ('${ratingIdOf(T1, ANA)}', '${T1}', '${ANA}', 'like', 'x')`);
  raw.exec(`INSERT INTO field_clock (tbl, row_id, field, hlc) VALUES ('titles', '${T1}', 'status', '0000000000001-0000-${uuid(1)}')`);
  raw.exec(`INSERT INTO change_log (op_id, hlc, device_id, tbl, row_id, fields_json, pushed) VALUES ('${uuid(7)}', 'h', '${uuid(8)}', 'titles', '${T1}', '{"status":"watched"}', 1)`);
  raw.exec(`INSERT INTO meta (key, value) VALUES ('sync_cursor', '57'), ('sync_status', '${JSON.stringify(STATUS)}'), ('tmdb_key', 'K')`);
  return { raw, T1, T2 };
}

const dumpAll = (raw: ReturnType<typeof emptyDb>) =>
  JSON.stringify(['titles', 'members', 'ratings', 'field_clock', 'change_log', 'posters'].map((t) => raw.selectArrays(`SELECT * FROM ${t} ORDER BY 1, 2`)));

describe('migration 2', () => {
  it('upgrades a v1 database: every row kept as it was, new tables and indexes added', () => {
    const { raw } = v1Fixture();
    const before = dumpAll(raw);
    migrate(raw);
    expect(SCHEMA_VERSION).toBe(2);
    expect(raw.selectValue('PRAGMA user_version')).toBe(2);
    expect(dumpAll(raw)).toEqual(before);
    expect(names(raw, 'table')).toEqual(['change_log', 'field_clock', 'member_status', 'members', 'meta', 'posters', 'ratings', 'recommendations', 'sync_inbox', 'titles']);
    for (const i of ['idx_titles_status', 'idx_titles_tmdb', 'idx_member_status_list', 'idx_member_status_title', 'idx_recs_to']) expect(names(raw, 'index')).toContain(i);
    const sql = (n: string) => raw.selectValues('SELECT sql FROM sqlite_master WHERE name = ?', [n]).map(String)[0]!;
    expect(sql('idx_titles_status')).toContain('WHERE deleted_at IS NULL AND merged_into IS NULL');
    expect(sql('idx_recs_to')).toContain('answered IS NULL AND withdrawn_at IS NULL');
  });

  it('resets the sync cursor and the skipped-batch counter, and keeps the rest of meta', () => {
    const { raw } = v1Fixture();
    migrate(raw);
    expect(raw.selectValue("SELECT value FROM meta WHERE key = 'sync_cursor'")).toBe('0');
    expect(JSON.parse(raw.selectValue("SELECT value FROM meta WHERE key = 'sync_status'") as string)).toEqual({ ...STATUS, undecryptable: 0 });
    expect(raw.selectValue("SELECT value FROM meta WHERE key = 'tmdb_key'")).toBe('K');
  });

  it('titles.status accepts NULL now but still refuses unknown values', () => {
    const { raw } = v1Fixture();
    migrate(raw);
    const add = (status: string) => raw.exec(`INSERT INTO titles (id, kind, title, status, added_by, created_at) VALUES ('${uuid(99)}', 'movie', 'x', ${status}, 'm', 'c')`);
    expect(() => add("'paused'")).toThrow();
    expect(() => add('NULL')).not.toThrow();
    expect(() => raw.exec("UPDATE titles SET status = NULL WHERE kind = 'series'")).not.toThrow();
  });

  it('the new tables enforce their checks', () => {
    const raw = emptyDb();
    new CinefiloDb(raw).migrate();
    const ms = (status: string) => raw.exec(`INSERT INTO member_status (id, title_id, member_id, status, updated_at) VALUES ('${uuid(Math.random() * 1e9)}', 't', 'm', ${status}, 'u')`);
    expect(() => ms("'dropped'")).toThrow();
    expect(() => ms("'watching'")).not.toThrow();
    expect(() => ms('NULL')).not.toThrow();
    const rec = (answered: string) => raw.exec(`INSERT INTO recommendations (id, title_id, from_member, to_member, created_at, answered) VALUES ('${uuid(Math.random() * 1e9)}', 't', 'a', 'b', 'c', ${answered})`);
    expect(() => rec("'maybe'")).toThrow();
    expect(() => rec("'accepted'")).not.toThrow();
    expect(() => rec('NULL')).not.toThrow();
  });

  it('is a no-op when run again, and a fresh database reaches the same schema', () => {
    const { raw } = v1Fixture();
    migrate(raw);
    const once = dumpAll(raw);
    migrate(raw);
    expect(dumpAll(raw)).toEqual(once);
    const fresh = emptyDb();
    migrate(fresh);
    const shape = (r: ReturnType<typeof emptyDb>) => r.selectValues("SELECT name || ':' || sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").map(String);
    expect(shape(raw).map((s) => s.replace(/\s+/g, ' '))).toEqual(shape(fresh).map((s) => s.replace(/\s+/g, ' ')));
  });
});
