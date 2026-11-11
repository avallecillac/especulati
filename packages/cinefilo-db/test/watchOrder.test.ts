import { describe, expect, it } from 'vitest';
import { TITLES_FORMAT } from '@especulati/cinefilo-core';
import { addManual, ANA, BEN, hashId, hashIdAsync, openTestDb, seedMembers, type TestDb } from './helpers.ts';

const ids = (t: TestDb) => ({ now: t.env.now, wallMs: t.env.wallMs, newOpId: t.env.newOpId, hash: hashIdAsync });
const file = (titles: unknown[]) => JSON.stringify({ format: TITLES_FORMAT, titles });
const ready = () => {
  const t = openTestDb(1, ANA);
  seedMembers(t, ANA);
  return t;
};
const setStatus = (t: TestDb, titleId: string, status: 'later' | 'watched', watchedOn?: string) => {
  t.tick();
  const r = t.db.dispatch({ kind: 'SetStatus', titleId, status, ...(watchedOn ? { watchedOn } : {}) }, t.env);
  if (!r.ok) throw new Error(r.error.kind);
};
const key = (t: TestDb, id: string) => t.raw.selectValue('SELECT watch_order FROM titles WHERE id = ?', [id]);
const numbers = (t: TestDb) => t.db.list('watched').map((i) => [i.title, i.watchOrder]);

describe('watch order: assignment and the computed number (D1, D2)', () => {
  it('marking watched gives the next number; the list is newest first', () => {
    const t = ready();
    const a = addManual(t, 'Alpha');
    const b = addManual(t, 'Bravo');
    const c = addManual(t, 'Charlie');
    setStatus(t, b, 'watched', '2026-01-05');
    setStatus(t, a, 'watched', '2026-01-01');
    setStatus(t, c, 'watched');
    expect([key(t, b), key(t, a), key(t, c)]).toEqual([1, 2, 3]);
    expect(numbers(t)).toEqual([['Charlie', 3], ['Alpha', 2], ['Bravo', 1]]);
    expect(t.db.title(a)?.watchOrder).toBe(2);
  });

  it('leaving Watched clears the key and renumbers the rest without writes', () => {
    const t = ready();
    const [a, b, c] = ['Alpha', 'Bravo', 'Charlie'].map((n) => addManual(t, n));
    for (const id of [a!, b!, c!]) setStatus(t, id, 'watched');
    setStatus(t, a!, 'later');
    expect(key(t, a!)).toBeNull();
    expect(numbers(t)).toEqual([['Charlie', 2], ['Bravo', 1]]);
    // marking it again puts it last
    setStatus(t, a!, 'watched');
    expect(numbers(t)[0]).toEqual(['Alpha', 3]);
    expect(key(t, a!)).toBe(4);
  });

  it('equal keys (two phones, offline) still get distinct numbers: date, created_at, id break the tie', () => {
    const t = ready();
    const a = addManual(t, 'Alpha');
    const b = addManual(t, 'Bravo');
    const c = addManual(t, 'Charlie');
    for (const [id, d] of [[a, '2026-02-01'], [b, '2026-01-01'], [c, '2026-01-01']] as const) setStatus(t, id, 'watched', d);
    t.raw.exec('UPDATE titles SET watch_order = 5');
    const n = numbers(t);
    expect(n.map((x) => x[1])).toEqual([3, 2, 1]);
    expect(n.map((x) => x[0])).toEqual(['Alpha', 'Charlie', 'Bravo']); // Bravo/Charlie: same day, Bravo created first
  });

  it('numbered titles come first, unnumbered watched titles and dropped series after them', () => {
    const t = ready();
    const a = addManual(t, 'Alpha', { status: 'watched', watchedOn: '2026-01-01' });
    const u = addManual(t, 'Undated-key', { status: 'watched', watchedOn: '2026-06-01' });
    t.raw.exec({ sql: 'UPDATE titles SET watch_order = NULL WHERE id = ?', bind: [u] });
    const s = addManual(t, 'Show', { mediaKind: 'series' });
    t.tick();
    expect(t.db.dispatch({ kind: 'SetStatus', titleId: s, status: 'dropped', watchedOn: '2026-07-01' }, t.env).ok).toBe(true);
    const w = t.db.list('watched');
    expect(w.map((i) => [i.id, i.watchOrder])).toEqual([[a, 1], [s, null], [u, null]]);
  });

  it('other lists and personal lists carry no number', () => {
    const t = ready();
    addManual(t, 'Alpha');
    expect(t.db.list('later')[0]!.watchOrder).toBeNull();
  });
});

describe('watch order in the titles file (D4)', () => {
  const entry = (n: number, extra: object = {}) => ({ kind: 'movie', title: `Film ${n}`, year: 1900 + n, status: 'watched', watchOrder: n, ...extra });

  it('sets orders on existing titles without one and adds new ones with theirs; preview counts ordersToSet', async () => {
    const t = ready();
    for (const n of [2, 3]) addManual(t, `Film ${n}`, { year: 1900 + n, status: 'watched', watchedOn: '2026-01-0' + n });
    t.raw.exec('UPDATE titles SET watch_order = NULL');
    const text = file([entry(1), entry(2), entry(3)]);
    const dry = await t.db.importTitles(text, ids(t), { dryRun: true });
    expect(dry).toEqual({ ok: true, value: { new: 1, existing: 2, ordersToSet: 2, invalid: 0, reasons: [], applied: false } });
    expect(key(t, hashId('cinefilo-title-v1|manual|movie|film 2|1902'))).toBeNull();
    const r = await t.db.importTitles(text, ids(t));
    expect(r).toMatchObject({ ok: true, value: { new: 1, existing: 2, ordersToSet: 2, applied: true } });
    expect(numbers(t)).toEqual([['Film 3', 3], ['Film 2', 2], ['Film 1', 1]]);
  });

  it('never overwrites an existing order, and re-importing changes nothing', async () => {
    const t = ready();
    const id = addManual(t, 'Film 1', { year: 1901, status: 'watched', watchedOn: '2026-01-01' });
    t.raw.exec({ sql: 'UPDATE titles SET watch_order = 9 WHERE id = ?', bind: [id] });
    const text = file([entry(1)]);
    const r = await t.db.importTitles(text, ids(t));
    expect(r).toMatchObject({ ok: true, value: { new: 0, existing: 1, ordersToSet: 0 } });
    expect(key(t, id)).toBe(9);
    const log = t.raw.selectValue('SELECT COUNT(*) FROM change_log');
    await t.db.importTitles(file([entry(1), entry(2)]), ids(t));
    const log2 = t.raw.selectValue('SELECT COUNT(*) FROM change_log');
    const again = await t.db.importTitles(file([entry(1), entry(2)]), ids(t));
    expect(again).toMatchObject({ ok: true, value: { new: 0, ordersToSet: 0 } });
    expect(t.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(log2);
    expect(Number(log2)).toBeGreaterThan(Number(log));
  });

  it('matches an existing title by TMDB id and kind', async () => {
    const t = ready();
    const id = addManual(t, 'Linked', { year: 2000, status: 'watched' });
    t.db.dispatch({ kind: 'LinkToTmdb', titleId: id, tmdbId: 555, details: {} }, t.env);
    t.raw.exec('UPDATE titles SET watch_order = NULL');
    const r = await t.db.importTitles(file([{ kind: 'movie', title: 'Linked', tmdbId: 555, status: 'watched', watchOrder: 7 }]), ids(t));
    expect(r).toMatchObject({ ok: true, value: { new: 0, existing: 1, ordersToSet: 1 } });
    expect(key(t, id)).toBe(7);
  });

  it('a watched entry without an order is numbered after the file\'s own orders', async () => {
    const t = ready();
    await t.db.importTitles(file([entry(5), { kind: 'movie', title: 'No Order', status: 'watched' }]), ids(t));
    expect(numbers(t)).toEqual([['No Order', 2], ['Film 5', 1]]);
    expect(key(t, hashId('cinefilo-title-v1|manual|movie|no order|'))).toBe(6);
  });

  it('a later-watched title joins after the imported history', async () => {
    const t = ready();
    await t.db.importTitles(file([entry(1), entry(2)]), ids(t));
    const x = addManual(t, 'Fresh');
    setStatus(t, x, 'watched');
    expect(key(t, x)).toBe(3);
  });
});

describe('review marks in lists', () => {
  it('say who wrote a review', () => {
    const t = ready();
    const a = addManual(t, 'Alpha');
    const b = addManual(t, 'Bravo');
    t.tick();
    const rate = (id: string, member: string, review: string) =>
      t.db.dispatch({ kind: 'SetReview', titleId: id, memberId: member, ratingId: hashId(`cinefilo-rating-v1|${id}|${member}`), review }, t.env);
    t.db.setMeta('member_id', ANA);
    expect(rate(a, ANA, 'mine').ok).toBe(true);
    t.db.setMeta('member_id', BEN);
    expect(rate(a, BEN, 'theirs').ok).toBe(true);
    expect(rate(b, BEN, 'only theirs').ok).toBe(true);
    t.db.setMeta('member_id', ANA);
    const items = Object.fromEntries(t.db.list('later').map((i) => [i.title, [i.reviewedByMe, i.reviewedByPartner]]));
    expect(items).toEqual({ Alpha: [true, true], Bravo: [false, true] });
  });
});
