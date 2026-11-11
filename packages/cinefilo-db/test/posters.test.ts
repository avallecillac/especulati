import { describe, expect, it } from 'vitest';
import type { Instant } from '@especulati/cinefilo-core';
import { addManual, ANA, openTestDb, seedMembers } from './helpers.ts';

describe('poster cache', () => {
  it('stores and replaces bytes, and stays out of change_log and the export', () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const id = addManual(t, 'Poster Film');
    const before = Number(t.raw.selectValue('SELECT count(*) FROM change_log'));
    expect(t.db.getPoster(id)).toBeNull();
    t.db.putPoster(id, 'image/jpeg', new Uint8Array([1, 2, 3]), '2026-09-27T12:00:00.000Z');
    expect(t.db.getPoster(id)).toEqual({ mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) });
    t.db.putPoster(id, 'image/jpeg', new Uint8Array([9]), '2026-09-27T12:00:01.000Z');
    expect(t.db.getPoster(id)?.bytes).toEqual(new Uint8Array([9]));
    expect(Number(t.raw.selectValue('SELECT count(*) FROM change_log'))).toBe(before);
    expect(t.db.exportText('2026-09-27T12:00:00.000Z' as Instant)).not.toContain('poster_bytes');
  });
});
