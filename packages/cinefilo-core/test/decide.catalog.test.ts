import { describe, expect, it } from 'vitest';
import { decide, type Command, type Snapshot } from '../src/index.ts';
import { memberId, NOW, title, titleId, day } from './fixtures.ts';

const run = (cmd: Command, snap: Snapshot = {}) => decide(snap, cmd, NOW);
const changes = (cmd: Command, snap: Snapshot = {}) => {
  const r = run(cmd, snap);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.changes;
};
const add = (p: Partial<Extract<Command, { kind: 'AddTitle' }>> = {}): Command => ({
  kind: 'AddTitle', titleId: titleId(1), mediaKind: 'movie', title: 'Stalker', year: 1979, addedBy: memberId(1), ...p,
});

describe('AddTitle', () => {
  it('Add a movie offline: one insert, status later, in Watch later', () => {
    expect(changes(add())).toEqual([{
      tbl: 'titles', rowId: titleId(1),
      fields: { kind: 'movie', title: 'Stalker', year: 1979, status: 'later', watched_on: null, added_by: memberId(1), created_at: NOW },
    }]);
  });
  it('New title defaults to later', () => {
    expect(changes(add())[0]!.fields['status']).toBe('later');
  });
  it('Blank title rejected', () => {
    for (const t of ['', '   ']) expect(run(add({ title: t }))).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
  });
  it('trims the title and carries TMDB details, genres as JSON', () => {
    const f = changes(add({
      title: '  Severance ', mediaKind: 'series', year: 2022, tmdbId: 95396, originalTitle: 'Severance', posterUrl: '/p.jpg',
      genres: ['Drama', 'Sci-Fi'], seasonCount: 2,
    }))[0]!.fields;
    expect(f).toMatchObject({
      title: 'Severance', tmdb_id: 95396, original_title: 'Severance', poster_url: '/p.jpg', genres: '["Drama","Sci-Fi"]', season_count: 2,
    });
  });
  it('picking another status while adding: watched needs a date', () => {
    expect(changes(add({ status: 'watched', watchedOn: '2026-09-20' }))[0]!.fields).toMatchObject({ status: 'watched', watched_on: '2026-09-20' });
    expect(run(add({ status: 'watched' })).ok).toBe(false);
  });
  it('a movie cannot be added as watching or dropped', () => {
    expect(run(add({ status: 'watching' })).ok).toBe(false);
    expect(run(add({ mediaKind: 'series', status: 'watching' })).ok).toBe(true);
  });
  it('Re-adding an existing title: AlreadyExists with the id to open', () => {
    expect(run(add(), { title: title() })).toEqual({ ok: false, error: { kind: 'AlreadyExists', id: titleId(1) } });
  });
  it('re-adding a title merged away points at the survivor', () => {
    expect(run(add(), { title: title({ mergedInto: titleId(2) }) })).toEqual({
      ok: false, error: { kind: 'AlreadyExists', id: titleId(2) },
    });
  });
  it('re-adding a removed title revives it (derived ids make a fresh insert impossible)', () => {
    const c = changes(add(), { title: title({ deletedAt: NOW }) });
    expect(c).toHaveLength(1);
    expect(c[0]!.fields).toMatchObject({ deleted_at: null });
  });
  it('rejects malformed ids and values', () => {
    expect(run(add({ titleId: 'x' })).ok).toBe(false);
    expect(run(add({ year: 12 })).ok).toBe(false);
    expect(run(add({ tmdbId: 0 })).ok).toBe(false);
    expect(run(add({ mediaKind: 'show' as never })).ok).toBe(false);
  });
});

describe('EditTitleDetails', () => {
  const edit = (p: object): Command => ({ kind: 'EditTitleDetails', titleId: titleId(1), ...p });
  it('emits only the fields given, so concurrent edits to different fields both survive', () => {
    expect(changes(edit({ year: 1980 }), { title: title() })).toEqual([{ tbl: 'titles', rowId: titleId(1), fields: { year: 1980 } }]);
    expect(changes(edit({ genres: ['Drama'] }), { title: title() })[0]!.fields).toEqual({ genres: '["Drama"]' });
  });
  it('null clears optional fields; the name is trimmed and required', () => {
    expect(changes(edit({ originalTitle: null, runtimeMin: 163, seasonCount: null }), { title: title() })[0]!.fields)
      .toEqual({ original_title: null, runtime_min: 163, season_count: null });
    expect(changes(edit({ title: ' Solaris ' }), { title: title() })[0]!.fields).toEqual({ title: 'Solaris' });
    expect(run(edit({ title: ' ' }), { title: title() })).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
  });
  it('NotFound when missing, removed or merged away', () => {
    for (const t of [null, title({ deletedAt: NOW }), title({ mergedInto: titleId(2) })]) {
      expect(run(edit({ year: 1980 }), { title: t })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    }
  });
});

describe('LinkToTmdb', () => {
  const link = (p: object = {}): Command => ({
    kind: 'LinkToTmdb', titleId: titleId(1), tmdbId: 1398,
    details: { title: 'Stalker (TMDB)', year: 1979, posterUrl: '/s.jpg', genres: ['Sci-Fi'], runtimeMin: 162 }, ...p,
  });
  it('Link keeps ratings and status: same row id, fills only empty details', () => {
    const c = changes(link(), { title: title({ year: 1980, status: 'watched', watchedOn: day('2026-09-01') }) });
    expect(c).toEqual([{
      tbl: 'titles', rowId: titleId(1),
      fields: { tmdb_id: 1398, poster_url: '/s.jpg', genres: '["Sci-Fi"]', runtime_min: 162 },
    }]);
  });
  it('relinking to the same id is fine, to another id is rejected', () => {
    expect(run(link(), { title: title({ tmdbId: 1398 }) }).ok).toBe(true);
    expect(run(link(), { title: title({ tmdbId: 5 }) }).ok).toBe(false);
  });
  it('NotFound on a missing title', () => {
    expect(run(link(), { title: null })).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});

describe('RemoveTitle / RestoreTitle', () => {
  const rm: Command = { kind: 'RemoveTitle', titleId: titleId(1) };
  const rs: Command = { kind: 'RestoreTitle', titleId: titleId(1) };
  it('Remove tombstones with now; ratings are untouched', () => {
    expect(changes(rm, { title: title() })).toEqual([{ tbl: 'titles', rowId: titleId(1), fields: { deleted_at: NOW } }]);
  });
  it('Remove with undo: restore clears the tombstone', () => {
    expect(changes(rs, { title: title({ deletedAt: NOW }) })).toEqual([{ tbl: 'titles', rowId: titleId(1), fields: { deleted_at: null } }]);
  });
  it('are idempotent', () => {
    expect(changes(rm, { title: title({ deletedAt: NOW }) })).toEqual([]);
    expect(changes(rs, { title: title() })).toEqual([]);
  });
  it('NotFound when the title is absent', () => {
    expect(run(rm, { title: null }).ok).toBe(false);
    expect(run(rs, { title: null }).ok).toBe(false);
  });
});
