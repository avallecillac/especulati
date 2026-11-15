import { describe, expect, it } from 'vitest';
import { tierOf } from '@especulati/cinefilo-core';
import { addManual, ANA, hashId, openTestDb, seedMembers, type TestDb } from './helpers.ts';

const ready = () => {
  const t = openTestDb(1, ANA);
  seedMembers(t, ANA);
  return t;
};
const addTmdb = (t: TestDb, n: number, extra: Record<string, unknown> = {}): string => {
  const id = hashId(`cinefilo-title-v1|tmdb|movie|${n}`);
  t.tick();
  const r = t.db.dispatch({ kind: 'AddTitle', titleId: id, mediaKind: 'movie', title: `Film ${n}`, tmdbId: n, addedBy: ANA, ...extra } as never, t.env);
  if (!r.ok) throw new Error(r.error.kind);
  return id;
};
const fill = (t: TestDb, titleId: string, p: Record<string, unknown> = {}) => {
  t.tick();
  return t.db.dispatch({ kind: 'FillTmdbCredits', titleId, countries: ['US'], directors: ['Francis Ford Coppola'], leadActor: 'Al Pacino', leadActress: 'Diane Keaton', ...p } as never, t.env);
};

describe('needsCredits (D5)', () => {
  it('lists live linked titles whose countries are NULL, newest first, and respects the limit', () => {
    const t = ready();
    const a = addTmdb(t, 1);
    const b = addTmdb(t, 2);
    const c = addTmdb(t, 3);
    addManual(t, 'No tmdb');
    expect(t.db.needsCredits(10).map((x) => x.id)).toEqual([c, b, a]);
    expect(t.db.needsCredits(10)[0]).toEqual({ id: c, kind: 'movie', tmdbId: 3 });
    expect(t.db.needsCredits(2)).toHaveLength(2);
  });
  it('drops a title once it is filled, even when TMDB had nothing ([])', () => {
    const t = ready();
    const a = addTmdb(t, 1);
    const b = addTmdb(t, 2);
    expect(fill(t, a).ok).toBe(true);
    expect(fill(t, b, { countries: [], directors: [], leadActor: null, leadActress: null }).ok).toBe(true);
    expect(t.db.needsCredits(10)).toEqual([]);
    expect(t.raw.selectValue('SELECT countries FROM titles WHERE id = ?', [b])).toBe('[]');
  });
  it('skips removed and merged titles', () => {
    const t = ready();
    const a = addTmdb(t, 1);
    const b = addTmdb(t, 2);
    t.tick();
    t.db.dispatch({ kind: 'RemoveTitle', titleId: a }, t.env);
    t.raw.exec("UPDATE titles SET merged_into = ? WHERE id = ?", { bind: [a, b] });
    expect(t.db.needsCredits(10)).toEqual([]);
  });
});

describe('credits in the read models (D7)', () => {
  it('ListItem and the title detail carry the decoded fields', () => {
    const t = ready();
    const id = addTmdb(t, 238, { genres: ['Drama', 'Crime'], countries: ['US', 'IT'], directors: ['Francis Ford Coppola'], leadActor: 'Al Pacino', leadActress: 'Diane Keaton' });
    const item = t.db.list('later').find((x) => x.id === id)!;
    expect(item).toMatchObject({ genres: ['Drama', 'Crime'], countries: ['US', 'IT'], directors: ['Francis Ford Coppola'], leadActor: 'Al Pacino', leadActress: 'Diane Keaton' });
    expect(t.db.title(id)?.title).toMatchObject({ countries: ['US', 'IT'], directors: ['Francis Ford Coppola'], leadActor: 'Al Pacino', leadActress: 'Diane Keaton' });
  });
  it('a title without them has empty lists and null names (never fetched is not an error)', () => {
    const t = ready();
    const id = addManual(t, 'Plain');
    expect(t.db.list('later').find((x) => x.id === id)).toMatchObject({ genres: [], countries: [], directors: [], leadActor: null, leadActress: null });
    expect(t.db.title(id)?.title).toMatchObject({ countries: null, directors: null, leadActor: null, leadActress: null });
  });
  it('personal lists carry them too', () => {
    const t = ready();
    const id = addTmdb(t, 5, { to: 'me', memberStatusId: hashId('ms5'), countries: ['FR'], directors: ['A'] });
    expect(t.db.list('later', 'me').find((x) => x.id === id)).toMatchObject({ countries: ['FR'], directors: ['A'] });
  });
});

describe('local writes (D3)', () => {
  const tiers = (t: TestDb) => t.raw.selectObjects('SELECT tbl, fields_json FROM change_log ORDER BY seq').filter((r) => r['tbl'] === 'titles').map((r) => tierOf('titles', JSON.parse(r['fields_json'] as string) as never));
  it('an add with credits is two ops on one row in one transaction, base then c', () => {
    const t = ready();
    const id = addTmdb(t, 9, { countries: ['US'], directors: ['A'], status: 'watched', watchedOn: '2026-01-01' });
    const rows = t.raw.selectObjects('SELECT fields_json FROM change_log WHERE tbl = ? AND row_id = ? ORDER BY seq', ['titles', id]);
    expect(rows).toHaveLength(2);
    expect(tiers(t)).toEqual(['p', 'c']);
    expect(t.raw.selectValue('SELECT countries FROM titles WHERE id = ?', [id])).toBe('["US"]');
    expect(t.raw.selectValue('SELECT COUNT(*) FROM field_clock WHERE row_id = ? AND field = ?', [id, 'countries'])).toBe(1);
  });
  it('FillTmdbCredits is one tier-c op, and a second fill writes nothing', () => {
    const t = ready();
    const id = addTmdb(t, 9);
    const before = Number(t.raw.selectValue('SELECT COUNT(*) FROM change_log'));
    expect(fill(t, id)).toEqual({ ok: true, value: { changes: 1 } });
    expect(fill(t, id, { directors: ['Other'] })).toEqual({ ok: true, value: { changes: 0 } });
    expect(Number(t.raw.selectValue('SELECT COUNT(*) FROM change_log'))).toBe(before + 1);
    expect(tiers(t).at(-1)).toBe('c');
    expect(t.raw.selectValue('SELECT directors FROM titles WHERE id = ?', [id])).toBe('["Francis Ford Coppola"]');
  });
});

describe('export / import (D1)', () => {
  it('credits survive export → import, [] and null included, and arrive in a separate tier-c op', () => {
    const src = ready();
    const a = addTmdb(src, 1, { countries: ['US'], directors: ['A'], leadActor: 'X', leadActress: 'Y' });
    const b = addTmdb(src, 2, { countries: [], directors: [] });
    addManual(src, 'Plain');
    const text = src.db.exportText('2026-10-27T12:00:00.000Z' as never);
    const dst = openTestDb(2);
    const r = dst.db.import(text, dst.env);
    expect(r).toEqual({ ok: true, value: { added: 3 + 2, present: 0 } });
    expect(dst.db.exportText('2026-10-27T12:00:00.000Z' as never)).toBe(text);
    expect(dst.raw.selectValue('SELECT countries FROM titles WHERE id = ?', [b])).toBe('[]');
    // title rows that carry credits are two ops (base, then c); the others stay one
    expect(dst.raw.selectValue("SELECT COUNT(*) FROM change_log WHERE tbl = 'titles' AND row_id = ?", [a])).toBe(2);
    for (const row of dst.raw.selectObjects("SELECT fields_json FROM change_log WHERE tbl = 'titles'")) {
      const f = JSON.parse(row['fields_json'] as string) as Record<string, unknown>;
      expect(tierOf('titles', f as never) === 'c' ? Object.keys(f).every((k) => ['countries', 'directors', 'lead_actor', 'lead_actress'].includes(k)) : !('countries' in f)).toBe(true);
    }
  });
  it('a file without the credits keys imports as never fetched', () => {
    const src = ready();
    addTmdb(src, 1, { countries: ['US'] });
    const file = JSON.parse(src.db.exportText('2026-10-27T12:00:00.000Z' as never)) as { titles: Record<string, unknown>[] };
    for (const t of file.titles) for (const k of ['countries', 'directors', 'leadActor', 'leadActress']) delete t[k];
    const dst = openTestDb(2);
    expect(dst.db.import(JSON.stringify(file), dst.env).ok).toBe(true);
    expect(dst.db.needsCredits(10)).toHaveLength(1);
  });
});
