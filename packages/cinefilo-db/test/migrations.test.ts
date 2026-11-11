import { describe, expect, it } from 'vitest';
import { CinefiloDb } from '../src/index.ts';
import { emptyDb } from './helpers.ts';

const names = (raw: ReturnType<typeof emptyDb>, type: string): string[] =>
  raw.selectValues(`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, [type]).map(String);

describe('migration 1', () => {
  it('migrates an empty database to schema v1', () => {
    const raw = emptyDb();
    const db = new CinefiloDb(raw);
    db.migrate();
    expect(db.schemaVersion).toBe(1);
    expect(names(raw, 'table')).toEqual(['change_log', 'field_clock', 'members', 'meta', 'posters', 'ratings', 'sync_inbox', 'titles']);
    expect(names(raw, 'index')).toContain('idx_titles_status');
    expect(names(raw, 'index')).toContain('idx_titles_tmdb');
    expect(names(raw, 'index')).toContain('idx_ratings_title');
  });

  it('is idempotent', () => {
    const raw = emptyDb();
    const db = new CinefiloDb(raw);
    db.migrate();
    db.migrate();
    expect(db.schemaVersion).toBe(1);
  });

  it('the partial indexes only cover live, unmerged rows', () => {
    const raw = emptyDb();
    new CinefiloDb(raw).migrate();
    const sql = (n: string) => raw.selectValues('SELECT sql FROM sqlite_master WHERE name = ?', [n]).map(String)[0]!;
    expect(sql('idx_titles_status')).toContain('WHERE deleted_at IS NULL AND merged_into IS NULL');
    expect(sql('idx_titles_tmdb')).toContain('WHERE deleted_at IS NULL AND merged_into IS NULL');
    expect(sql('idx_ratings_title')).toContain('WHERE deleted_at IS NULL');
  });

  it('the CHECK constraints refuse bad enums and over-long reviews', () => {
    const raw = emptyDb();
    new CinefiloDb(raw).migrate();
    const title = (kind: string, status: string) =>
      raw.exec(`INSERT INTO titles (id, kind, title, status, added_by, created_at) VALUES ('t', '${kind}', 'x', '${status}', 'm', 'c')`);
    expect(() => title('book', 'later')).toThrow();
    expect(() => title('movie', 'paused')).toThrow();
    expect(() => title('movie', 'later')).not.toThrow();
    expect(() => raw.exec(`INSERT INTO ratings (id, title_id, member_id, verdict, updated_at) VALUES ('r', 't', 'm', 'love', 'u')`)).toThrow();
    expect(() => raw.exec(`INSERT INTO ratings (id, title_id, member_id, review, updated_at) VALUES ('r', 't', 'm', '${'x'.repeat(1001)}', 'u')`)).toThrow();
  });
});
