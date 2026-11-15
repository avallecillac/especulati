import { describe, expect, it } from 'vitest';
import {
  decide, parseExport, parseRemoteOp, serializeExport, splitMixedTiers, tierOf, WRITABLE_FIELDS,
  type Change, type CinefiloExport, type Command, type OpWire, type Snapshot,
} from '../src/index.ts';
import { hlc, instant, memberId, NOW, title, titleId, uuid } from './fixtures.ts';

const run = (cmd: Command, snap: Snapshot): Change[] => {
  const r = decide(snap, cmd, NOW);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return [...r.value.changes];
};
const reject = (cmd: Command, snap: Snapshot) => {
  const r = decide(snap, cmd, NOW);
  return r.ok ? null : r.error;
};

const fill = (p: Partial<Extract<Command, { kind: 'FillTmdbCredits' }>> = {}): Command => ({
  kind: 'FillTmdbCredits', titleId: titleId(1), countries: ['US', 'IT'], directors: ['Francis Ford Coppola'], leadActor: 'Al Pacino', leadActress: 'Diane Keaton', ...p,
});
const linked = (p = {}) => title({ tmdbId: 238, ...p });

describe('FillTmdbCredits (D2)', () => {
  it('writes the four fields on a linked title that was never fetched; countries and directors as JSON text', () => {
    expect(run(fill(), { title: linked() })).toEqual([
      { tbl: 'titles', rowId: titleId(1), fields: { countries: '["US","IT"]', directors: '["Francis Ford Coppola"]', lead_actor: 'Al Pacino', lead_actress: 'Diane Keaton' } },
    ]);
  });
  it('writes [] for none, so the title counts as fetched; no actress stays unwritten', () => {
    const [c] = run(fill({ countries: [], directors: [], leadActor: null, leadActress: null }), { title: linked() });
    expect(c!.fields).toEqual({ countries: '[]', directors: '[]' });
  });
  it('writes only the empty ones of lead_actor / lead_actress / directors', () => {
    const [c] = run(fill(), { title: linked({ directors: ['Someone'], leadActor: 'Kept' }) });
    expect(c!.fields).toEqual({ countries: '["US","IT"]', lead_actress: 'Diane Keaton' });
  });
  it('is a no-op when already fetched (countries not null), without a tmdb id, or when removed or merged', () => {
    expect(run(fill(), { title: linked({ countries: [] }) })).toEqual([]);
    expect(run(fill(), { title: title() })).toEqual([]);
    expect(run(fill(), { title: linked({ deletedAt: instant('2026-09-02T00:00:00.000Z') }) })).toEqual([]);
    expect(run(fill(), { title: linked({ mergedInto: titleId(2) }) })).toEqual([]);
  });
  it('NotFound for an unknown title; InvalidInput for bad values', () => {
    expect(reject(fill(), { title: null })).toEqual({ kind: 'NotFound' });
    for (const bad of [{ countries: ['us'] }, { countries: ['USA'] }, { directors: [''] }, { directors: ['a', 'b', 'c', 'd', 'e', 'f'] }, { leadActor: 'x'.repeat(201) }]) {
      expect(reject(fill(bad as never), { title: linked() })?.kind, JSON.stringify(bad)).toBe('InvalidInput');
    }
  });
});

describe('D1 validation through AddTitle and LinkToTmdb', () => {
  const add = (p = {}): Command => ({ kind: 'AddTitle', titleId: titleId(1), mediaKind: 'movie', title: 'The Godfather', tmdbId: 238, addedBy: memberId(1), ...p });
  it('AddTitle carries the new details', () => {
    const changes = run(add({ countries: ['US'], directors: ['A', 'B'], leadActor: ' Al Pacino ', leadActress: 'Diane Keaton' }), { title: null });
    const credits = changes.find((c) => 'countries' in c.fields)!;
    expect(credits.fields).toEqual({ countries: '["US"]', directors: '["A","B"]', lead_actor: 'Al Pacino', lead_actress: 'Diane Keaton' });
  });
  it('refuses bad country codes, too many countries or directors, and bad names', () => {
    const codes = Array.from({ length: 21 }, (_, i) => String.fromCharCode(65 + (i % 26)) + 'A');
    for (const bad of [{ countries: ['u'] }, { countries: ['usa'] }, { countries: [1] }, { countries: codes }, { directors: ['a', 'b', 'c', 'd', 'e', 'f'] }, { directors: ['  '] }, { directors: ['x'.repeat(201)] }, { leadActress: 'x'.repeat(201) }]) {
      expect(reject(add(bad), { title: null })?.kind, JSON.stringify(bad)).toBe('InvalidInput');
    }
    expect(run(add({ countries: ['US'], directors: ['A', 'B', 'C', 'D', 'E'] }), { title: null })).toBeTruthy();
  });
  const link = (details = {}): Command => ({ kind: 'LinkToTmdb', titleId: titleId(1), tmdbId: 238, details });
  it('LinkToTmdb fills each new field only when empty', () => {
    const details = { countries: ['US'], directors: ['A'], leadActor: 'X', leadActress: 'Y' };
    const fresh = run(link(details), { title: title() });
    expect(fresh.find((c) => 'countries' in c.fields)!.fields).toEqual({ countries: '["US"]', directors: '["A"]', lead_actor: 'X', lead_actress: 'Y' });
    const partly = run(link(details), { title: title({ countries: ['IT'], leadActor: 'Kept' }) });
    expect(partly.find((c) => 'directors' in c.fields)!.fields).toEqual({ directors: '["A"]', lead_actress: 'Y' });
    expect(partly.some((c) => 'countries' in c.fields)).toBe(false);
  });
  it('LinkToTmdb writes [] for none when still empty (the fetched marker)', () => {
    const [c] = run({ kind: 'LinkToTmdb', titleId: titleId(1), tmdbId: 238, details: { countries: [], directors: [] } }, { title: title({ tmdbId: 238 }) });
    expect(c!.fields).toEqual({ countries: '[]', directors: '[]' });
  });
});

describe('tier c (D3)', () => {
  it('a titles op that carries any credits field is tier c', () => {
    for (const f of ['countries', 'directors', 'lead_actor', 'lead_actress']) {
      expect(tierOf('titles', { [f]: null }), f).toBe('c');
      expect(WRITABLE_FIELDS.titles.has(f), f).toBe(true);
    }
    expect(tierOf('titles', { status: 'watched', watch_order: 3, countries: '[]' })).toBe('c');
    expect(tierOf('titles', { genres: '[]' })).toBe('base');
    expect(tierOf('ratings', { stars: 3 })).toBe('r');
  });
  it('splitMixedTiers leaves single-tier changes alone and splits mixed ones, base fields first', () => {
    const only: Change = { tbl: 'titles', rowId: titleId(1), fields: { countries: '[]' } };
    const base: Change = { tbl: 'titles', rowId: titleId(1), fields: { title: 'x' } };
    expect(splitMixedTiers([only, base])).toEqual([only, base]);
    const mixed: Change = { tbl: 'titles', rowId: titleId(1), fields: { kind: 'movie', status: 'watched', watch_order: 4, countries: '["US"]', lead_actor: 'A' } };
    expect(splitMixedTiers([mixed])).toEqual([
      { tbl: 'titles', rowId: titleId(1), fields: { kind: 'movie', status: 'watched', watch_order: 4 } },
      { tbl: 'titles', rowId: titleId(1), fields: { countries: '["US"]', lead_actor: 'A' } },
    ]);
  });
  it('AddTitle as watched with credits splits into a p change and a c change on the same row', () => {
    const changes = run(
      { kind: 'AddTitle', titleId: titleId(1), mediaKind: 'movie', title: 'The Godfather', tmdbId: 238, status: 'watched', watchedOn: '2026-09-20', addedBy: memberId(1), countries: ['US'], directors: ['A'] },
      { title: null, maxWatchOrder: 2 },
    );
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => tierOf(c.tbl as 'titles', c.fields))).toEqual(['p', 'c']);
    expect(changes.every((c) => c.rowId === titleId(1))).toBe(true);
    expect(changes[0]!.fields).toMatchObject({ kind: 'movie', title: 'The Godfather', watch_order: 3, tmdb_id: 238 });
    expect(changes[1]!.fields).toEqual({ countries: '["US"]', directors: '["A"]' });
  });
  it('a plain AddTitle with credits splits into a base change and a c change', () => {
    const changes = run({ kind: 'AddTitle', titleId: titleId(1), mediaKind: 'movie', title: 'T', addedBy: memberId(1), countries: [] }, { title: null });
    expect(changes.map((c) => tierOf(c.tbl as 'titles', c.fields))).toEqual(['base', 'c']);
  });
  it('a "Just me" add with credits keeps its status:null in the first change', () => {
    const me = memberId(1);
    const changes = run(
      { kind: 'AddTitle', titleId: titleId(1), mediaKind: 'movie', title: 'T', addedBy: me, to: 'me', memberStatusId: uuid(300), countries: ['US'] },
      { title: null, deviceMemberId: me },
    );
    const titles = changes.filter((c) => c.tbl === 'titles');
    expect(titles.map((c) => tierOf('titles', c.fields))).toEqual(['p', 'c']);
  });
});

describe('allow-list for the credits fields', () => {
  const DEV = uuid(9001);
  const op = (fields: Record<string, unknown>): OpWire => ({ op: uuid(5000), hlc: hlc(1000), tbl: 'titles', row: titleId(1), fields: fields as never });
  it('accepts valid values and null', () => {
    for (const f of [
      { countries: '[]' }, { countries: '["US","IT"]' }, { countries: null }, { directors: '["A","B"]' }, { directors: null },
      { lead_actor: 'Al Pacino' }, { lead_actor: null }, { lead_actress: 'Diane Keaton' }, { lead_actress: null },
    ]) expect(parseRemoteOp(op(f), DEV).ok, JSON.stringify(f)).toBe(true);
  });
  it('refuses anything else with a ParseError', () => {
    const many = JSON.stringify(Array.from({ length: 21 }, () => 'US'));
    for (const f of [
      { countries: 'not json' }, { countries: '["us"]' }, { countries: '["USA"]' }, { countries: '[1]' }, { countries: '{}' }, { countries: many }, { countries: 5 },
      { directors: '["a","b","c","d","e","f"]' }, { directors: '[""]' }, { directors: `["${'x'.repeat(201)}"]` }, { directors: '[1]' },
      { lead_actor: '' }, { lead_actor: 'x'.repeat(201) }, { lead_actress: 7 },
    ]) {
      const r = parseRemoteOp(op(f), DEV);
      expect(r.ok, JSON.stringify(f).slice(0, 60)).toBe(false);
    }
    const r = parseRemoteOp(op({ countries: '["us"]' }), DEV);
    expect(!r.ok && r.error.field).toBe('countries');
  });
});

describe('export (D1)', () => {
  const base = (): CinefiloExport => ({
    format: 'cinefilo/v1', exportedAt: instant('2026-09-27T12:00:00.000Z'),
    titles: [
      title({ id: titleId(1), tmdbId: 238, countries: ['US'], directors: ['Francis Ford Coppola'], leadActor: 'Al Pacino', leadActress: 'Diane Keaton' }),
      title({ id: titleId(2), tmdbId: 5, countries: [], directors: [] }),
      title({ id: titleId(3) }),
    ],
    members: [], ratings: [], memberStatus: [], recommendations: [],
  });
  it('round-trips the credits fields, [] and null included', () => {
    const r = parseExport(serializeExport(base()));
    expect(r.ok && r.value.titles).toEqual(base().titles);
  });
  it('a file without the keys reads them as null', () => {
    const o = JSON.parse(serializeExport(base()));
    for (const t of o.titles) for (const k of ['countries', 'directors', 'leadActor', 'leadActress']) delete t[k];
    const r = parseExport(JSON.stringify(o));
    expect(r.ok && r.value.titles.every((t) => t.countries === null && t.directors === null && t.leadActor === null && t.leadActress === null)).toBe(true);
  });
  it('refuses invalid values', () => {
    for (const [k, v] of [['countries', ['usa']], ['countries', 'US'], ['directors', [1]], ['directors', ['a', 'b', 'c', 'd', 'e', 'f']], ['leadActor', 5], ['leadActress', 'x'.repeat(201)]] as const) {
      const o = JSON.parse(serializeExport(base()));
      o.titles[0][k] = v;
      expect(parseExport(JSON.stringify(o)).ok, `${k}=${JSON.stringify(v)}`).toBe(false);
    }
  });
});
