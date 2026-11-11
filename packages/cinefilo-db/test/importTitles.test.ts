import { describe, expect, it } from 'vitest';
import { TITLES_FORMAT } from '@especulati/cinefilo-core';
import { addManual, ANA, hashId, hashIdAsync, openTestDb, seedMembers, type TestDb } from './helpers.ts';

const ids = (t: TestDb) => ({ now: t.env.now, wallMs: t.env.wallMs, newOpId: t.env.newOpId, hash: hashIdAsync });
const file = (titles: unknown[]) => JSON.stringify({ format: TITLES_FORMAT, titles });
const entry = (n: number, extra: object = {}) => ({ kind: 'movie', title: `Film ${n}`, year: 1900 + (n % 120), status: 'later', ...extra });

function ready() {
  const t = openTestDb(1, ANA);
  seedMembers(t, ANA);
  return t;
}

describe('importTitles (D3)', () => {
  it('dry run counts new, existing and invalid and writes nothing', async () => {
    const t = ready();
    addManual(t, 'Film 1', { year: 1901 });
    const before = t.raw.selectValue('SELECT COUNT(*) FROM change_log');
    const r = await t.db.importTitles(file([entry(1), entry(2), entry(3, { status: 'watched' })]), ids(t), { dryRun: true });
    expect(r).toEqual({ ok: true, value: { new: 2, existing: 1, invalid: 0, reasons: [], applied: false } });
    expect(t.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(before);
    expect(t.db.list('later')).toHaveLength(1);
  });

  it('imports every new title as the current member with its status, undated watched included', async () => {
    const t = ready();
    const r = await t.db.importTitles(file([entry(1), entry(2, { status: 'watched' }), { kind: 'series', title: 'Dark', status: 'watching' }]), ids(t));
    expect(r).toEqual({ ok: true, value: { new: 3, existing: 0, invalid: 0, reasons: [], applied: true } });
    expect(t.db.list('later').map((i) => i.title)).toEqual(['Film 1']);
    const w = t.db.list('watched');
    expect(w.map((i) => [i.title, i.watchedOn])).toEqual([['Film 2', null]]);
    expect(t.db.list('watching').map((i) => i.title)).toEqual(['Dark']);
    expect(t.raw.selectValues('SELECT DISTINCT added_by FROM titles')).toEqual([ANA]);
  });

  it('is idempotent: importing again adds nothing and writes no changes', async () => {
    const t = ready();
    const text = file([entry(1), entry(2, { tmdbId: 27205 })]);
    await t.db.importTitles(text, ids(t));
    const log = t.raw.selectValue('SELECT COUNT(*) FROM change_log');
    const r = await t.db.importTitles(text, ids(t));
    expect(r).toEqual({ ok: true, value: { new: 0, existing: 2, invalid: 0, reasons: [], applied: true } });
    expect(t.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(log);
  });

  it('a TMDB-id entry gets exactly the id a TMDB search add produces', async () => {
    const t = ready();
    await t.db.importTitles(file([{ kind: 'movie', title: 'Inception', year: 2010, tmdbId: 27205, status: 'watched' }]), ids(t));
    const searchId = hashId('cinefilo-title-v1|tmdb|movie|27205');
    expect(t.db.title(searchId)?.title.tmdbId).toBe(27205);
    // ...so the same film added later from search is already there
    const again = t.db.dispatch({ kind: 'AddTitle', titleId: searchId, mediaKind: 'movie', title: 'Inception', tmdbId: 27205, addedBy: ANA }, t.env);
    expect(again).toEqual({ ok: false, error: { kind: 'AlreadyExists', id: searchId } });
  });

  it('a manual entry gets the id a manual add produces; a TMDB entry already in the list under another id is existing', async () => {
    const t = ready();
    const manual = addManual(t, 'Nine', { year: 2009 });
    const linked = addManual(t, 'Linked', { year: 2000 });
    t.db.dispatch({ kind: 'LinkToTmdb', titleId: linked, tmdbId: 555, details: {} }, t.env);
    const r = await t.db.importTitles(file([{ kind: 'movie', title: 'Nine', year: 2009, status: 'later' }, { kind: 'movie', title: 'Linked', tmdbId: 555, status: 'later' }]), ids(t), { dryRun: true });
    expect(r).toMatchObject({ ok: true, value: { new: 0, existing: 2 } });
    expect(t.db.title(manual)).not.toBeNull();
  });

  it('a removed title with the same id is revived like a normal add', async () => {
    const t = ready();
    const id = addManual(t, 'Film 1', { year: 1901 });
    t.db.dispatch({ kind: 'RemoveTitle', titleId: id }, t.env);
    const r = await t.db.importTitles(file([entry(1)]), ids(t));
    expect(r).toMatchObject({ ok: true, value: { new: 1 } });
    expect(t.db.list('later').map((i) => i.id)).toEqual([id]);
  });

  it('bad files add nothing and say why', async () => {
    const t = ready();
    expect(await t.db.importTitles('{', ids(t))).toEqual({ ok: false, error: { field: 'file', reason: 'not JSON' } });
    expect(await t.db.importTitles(JSON.stringify({ format: 'cinefilo/v1', titles: [] }), ids(t))).toEqual({ ok: false, error: { field: 'format', reason: 'unsupported version' } });
    expect(t.db.list('later')).toEqual([]);
  });

  it('without a member on the device it refuses', async () => {
    const t = openTestDb(1);
    expect(await t.db.importTitles(file([entry(1)]), ids(t))).toMatchObject({ ok: false, error: { field: 'member' } });
  });

  it('keeps the file order in the list (first entry newest)', async () => {
    const t = ready();
    await t.db.importTitles(file([entry(1), entry(2), entry(3)]), ids(t));
    expect(t.db.list('later').map((i) => i.title)).toEqual(['Film 1', 'Film 2', 'Film 3']);
  });

  it('300 titles apply in one transaction, fast, and the changes are pushed', async () => {
    const t = ready();
    const titles = Array.from({ length: 300 }, (_, n) => entry(n, { status: n % 2 ? 'watched' : 'later', ...(n % 3 === 0 ? { tmdbId: 1000 + n } : {}) }));
    const log = Number(t.raw.selectValue('SELECT COUNT(*) FROM change_log'));
    const started = performance.now();
    const r = await t.db.importTitles(file(titles), ids(t));
    expect(performance.now() - started).toBeLessThan(5000);
    expect(r).toMatchObject({ ok: true, value: { new: 300, existing: 0, invalid: 0 } });
    expect(t.raw.selectValue('SELECT COUNT(*) FROM titles')).toBe(300);
    expect(Number(t.raw.selectValue('SELECT COUNT(*) FROM change_log'))).toBeGreaterThan(log);
  });
});

describe('undated watched titles and the details queue', () => {
  it('lists undated watched titles after dated ones', async () => {
    const t = ready();
    addManual(t, 'Dated', { status: 'watched', watchedOn: '2020-01-01' });
    await t.db.importTitles(file([{ kind: 'movie', title: 'Undated', status: 'watched' }]), ids(t));
    expect(t.db.list('watched').map((i) => i.title)).toEqual(['Dated', 'Undated']);
  });

  it('needsDetails returns live TMDB-linked titles with neither poster nor genres', async () => {
    const t = ready();
    await t.db.importTitles(file([{ kind: 'movie', title: 'A', tmdbId: 11, status: 'later' }, { kind: 'movie', title: 'B', status: 'later' }]), ids(t));
    expect(t.db.needsDetails().map((n) => [n.tmdbId, n.kind])).toEqual([[11, 'movie']]);
    const id = hashId('cinefilo-title-v1|tmdb|movie|11');
    t.db.dispatch({ kind: 'LinkToTmdb', titleId: id, tmdbId: 11, details: { genres: ['Drama'] } }, t.env);
    expect(t.db.needsDetails()).toEqual([]);
  });
});
