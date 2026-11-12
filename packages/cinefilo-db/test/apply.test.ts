import { describe, expect, it } from 'vitest';
import type { Hlc } from '@especulati/cinefilo-core';
import type { DeviceId } from '@especulati/sync-core';
import { addManual, ANA, openTestDb, rate, seedMembers, uuid } from './helpers.ts';

describe('local decisions (3.2)', () => {
  it('a dispatched command writes rows, field_clock and change_log together', () => {
    const t = openTestDb();
    seedMembers(t);
    const id = addManual(t, 'Solaris', { year: 1972 });
    expect(t.raw.selectValue('SELECT title FROM titles WHERE id = ?', [id])).toBe('Solaris');
    const fields = t.raw.selectValues('SELECT field FROM field_clock WHERE tbl = ? AND row_id = ?', ['titles', id]).map(String);
    expect(fields).toEqual(expect.arrayContaining(['kind', 'title', 'status', 'year', 'added_by', 'created_at', 'watched_on']));
    const log = t.raw.selectObjects('SELECT tbl, row_id, pushed FROM change_log WHERE row_id = ?', [id]);
    expect(log).toEqual([{ tbl: 'titles', row_id: id, pushed: 0 }]);
    expect(t.db.syncStore.pendingCount()).toBeGreaterThan(0);
  });

  it('a rejected command changes nothing', () => {
    const t = openTestDb();
    seedMembers(t);
    const before = Number(t.raw.selectValue('SELECT COUNT(*) FROM change_log'));
    const r = t.db.dispatch({ kind: 'SetStatus', titleId: uuid(9), status: 'later' }, t.env);
    expect(r).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(Number(t.raw.selectValue('SELECT COUNT(*) FROM change_log'))).toBe(before);
  });

  it("another member's rating is rejected (NotYourRating) and writes nothing", () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const id = addManual(t, 'Heat');
    const r = t.db.dispatch({ kind: 'SetStars', titleId: id, memberId: uuid(0xb1), ratingId: uuid(77), stars: 8 }, t.env);
    expect(r).toEqual({ ok: false, error: { kind: 'NotYourRating' } });
    expect(t.raw.selectValue('SELECT COUNT(*) FROM ratings')).toBe(0);
    rate(t, id, 8);
    expect(t.raw.selectValue('SELECT stars FROM ratings')).toBe(8);
  });
});

describe('remote ops (3.2)', () => {
  const dev = uuid(0xe1) as DeviceId;
  const hlc = (ms: number) => `${String(ms).padStart(13, '0')}-0000-${dev}` as Hlc;
  const wall = () => Date.UTC(2026, 8, 27, 12, 0, 0);

  it('applies a pulled page and advances the cursor', () => {
    const t = openTestDb();
    const r = t.db.syncStore.applyPulledPage(
      [{ opId: uuid(1), hlc: hlc(5), deviceId: dev, tbl: 'members', rowId: uuid(0xb1), fields: { name: 'Ben', created_at: '2026-09-27T12:00:00.000Z' } }],
      7, wall,
    );
    expect(r).toEqual({ applied: 1, skipped: 0, parked: 0 });
    expect(t.raw.selectValue('SELECT name FROM members')).toBe('Ben');
    expect(t.db.syncStore.syncMeta().cursor).toBe(7);
    expect(t.raw.selectValue('SELECT pushed FROM change_log')).toBe(1);
  });

  it('rolls the whole page back when one op fails a CHECK, and leaves the cursor', () => {
    const t = openTestDb();
    const good = { opId: uuid(1), hlc: hlc(5), deviceId: dev, tbl: 'members', rowId: uuid(0xb1), fields: { name: 'Ben', created_at: 'c' } } as const;
    const bad = {
      opId: uuid(2), hlc: hlc(6), deviceId: dev, tbl: 'titles', rowId: uuid(0x71),
      fields: { kind: 'movie', title: 'x', status: 'bogus', added_by: uuid(0xb1), created_at: 'c' },
    } as const;
    expect(() => t.db.syncStore.applyPulledPage([good, bad], 9, wall)).toThrow();
    expect(t.raw.selectValue('SELECT COUNT(*) FROM members')).toBe(0);
    expect(t.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(0);
    expect(t.db.syncStore.syncMeta().cursor).toBe(0);
  });

  it('the allow-list parser skips ops with unknown tables, fields or values, so they never reach the DB', async () => {
    const { parseRemoteOp } = await import('@especulati/cinefilo-core');
    const op = (tbl: string, fields: Record<string, string | null>) => ({ op: uuid(3), hlc: hlc(1), tbl, row: uuid(4), fields });
    expect(parseRemoteOp(op('posters', { mime: 'x' }), dev).ok).toBe(false);
    expect(parseRemoteOp(op('titles', { sql: 'x' }), dev).ok).toBe(false);
    expect(parseRemoteOp(op('titles', { status: 'bogus' }), dev).ok).toBe(false);
    expect(parseRemoteOp(op('titles', { status: 'later' }), dev).ok).toBe(true);
  });

  it('parks a rating whose title has not arrived, then applies it when the title does', () => {
    const t = openTestDb();
    const rating = { opId: uuid(1), hlc: hlc(5), deviceId: dev, tbl: 'ratings', rowId: uuid(0x91), fields: { title_id: uuid(0x71), member_id: uuid(0xb1), verdict: 'like', updated_at: 'u' } } as const;
    expect(t.db.syncStore.applyPulledPage([rating], 1, wall).parked).toBe(1);
    expect(t.raw.selectValue('SELECT COUNT(*) FROM ratings')).toBe(0);
    const title = { opId: uuid(2), hlc: hlc(4), deviceId: dev, tbl: 'titles', rowId: uuid(0x71), fields: { kind: 'movie', title: 'T', status: 'later', added_by: uuid(0xb1), created_at: 'c' } } as const;
    const r = t.db.syncStore.applyPulledPage([title], 2, wall);
    expect(r.parked).toBe(0);
    expect(t.raw.selectValue('SELECT verdict FROM ratings')).toBe('like');
    expect(t.db.syncStore.inboxOpIds()).toEqual([]);
  });
});
