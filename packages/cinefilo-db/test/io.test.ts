import { describe, expect, it } from 'vitest';
import type { Instant } from '@especulati/cinefilo-core';
import { addManual, ANA, BEN, dump, openTestDb, rate, seedMembers } from './helpers.ts';

const AT = '2026-09-27T12:00:00.000Z' as Instant;

function seeded() {
  const t = openTestDb(1, ANA);
  seedMembers(t, ANA);
  const a = addManual(t, 'Amélie', { year: 2001, status: 'watched', watchedOn: '2026-01-02' });
  const b = addManual(t, 'Gone Film');
  rate(t, a, 'like', 'lovely');
  t.db.setMeta('member_id', BEN);
  rate(t, a, 'dislike');
  t.db.setMeta('member_id', ANA);
  t.tick();
  t.db.dispatch({ kind: 'RemoveTitle', titleId: b }, t.env);
  t.db.setMeta('tmdb_key', 'TMDB-SECRET-KEY');
  return t;
}

const logical = (t: ReturnType<typeof openTestDb>) => t.db.exportText(AT);

describe('export / import (3.5)', () => {
  it('export → import into an empty database equals the original, removed titles and both ratings included', () => {
    const src = seeded();
    const text = logical(src);
    const dst = openTestDb(2);
    const r = dst.db.import(text, dst.env);
    expect(r).toEqual({ ok: true, value: { added: 2 + 2 + 2, present: 0 } });
    expect(logical(dst)).toBe(text);
    expect(dst.db.list('watched')).toHaveLength(1);
  });

  it('importing twice is a no-op', () => {
    const src = seeded();
    const text = logical(src);
    const dst = openTestDb(2);
    dst.db.import(text, dst.env);
    const before = dump(dst.raw);
    const logBefore = dst.raw.selectValue('SELECT COUNT(*) FROM change_log');
    const r = dst.db.import(text, dst.env);
    expect(r).toEqual({ ok: true, value: { added: 0, present: 6 } });
    expect(dump(dst.raw)).toBe(before);
    expect(dst.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(logBefore);
  });

  it('imported rows are local writes, so they are pushed to the space', () => {
    const dst = openTestDb(2);
    dst.db.import(logical(seeded()), dst.env);
    expect(dst.db.syncStore.pendingCount()).toBe(6);
  });

  it('never overwrites a newer local edit of a row it already has', () => {
    const src = seeded();
    const text = logical(src);
    const dst = openTestDb(2);
    dst.db.import(text, dst.env);
    dst.tick();
    const id = dst.raw.selectValues("SELECT id FROM titles WHERE title = 'Amélie'").map(String)[0]!;
    dst.db.dispatch({ kind: 'EditTitleDetails', titleId: id, title: 'Amélie (edited)' }, dst.env);
    dst.db.import(text, dst.env);
    expect(dst.raw.selectValue('SELECT title FROM titles WHERE id = ?', [id])).toBe('Amélie (edited)');
  });

  it('rejects an unknown version or a bad row, and changes nothing', () => {
    const src = seeded();
    const good = JSON.parse(logical(src)) as { format: string; titles: Record<string, unknown>[] };
    const dst = openTestDb(2);
    const v2 = JSON.stringify({ ...good, format: 'cinefilo/v2' });
    expect(dst.db.import(v2, dst.env).ok).toBe(false);
    const bad = JSON.stringify({ ...good, titles: [...good.titles.slice(0, 1), { ...good.titles[1], status: 'bogus' }] });
    expect(dst.db.import(bad, dst.env).ok).toBe(false);
    expect(dst.db.import('not json', dst.env).ok).toBe(false);
    expect(dst.raw.selectValue('SELECT COUNT(*) FROM titles')).toBe(0);
    expect(dst.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(0);
  });

  it('applies completely or not at all when the write fails midway', () => {
    const dst = openTestDb(2);
    // A trigger makes the third inserted rating fail: the whole file must roll back.
    dst.raw.exec(`CREATE TRIGGER boom BEFORE INSERT ON ratings BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    expect(() => dst.db.import(logical(seeded()), dst.env)).toThrow();
    for (const t of ['titles', 'members', 'ratings', 'change_log', 'field_clock']) expect(dst.raw.selectValue(`SELECT COUNT(*) FROM ${t}`)).toBe(0);
  });

  it('the file never carries meta, the TMDB key or poster bytes', () => {
    const src = seeded();
    src.raw.exec(`INSERT INTO posters (title_id, mime, bytes, fetched_at) VALUES ('p', 'image/jpeg', x'ffd8', 'now')`);
    const text = logical(src);
    expect(text).not.toContain('TMDB-SECRET-KEY');
    expect(text).not.toContain('tmdb_key');
    expect(text).not.toContain('device_id');
    expect(text).not.toContain('posters');
  });
});
