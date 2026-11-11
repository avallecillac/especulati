import { describe, expect, it } from 'vitest';
import { decide, type ClockedRating, type ClockedTitle, type Command, type ReconcileSnapshot, type TitleRow } from '../src/index.ts';
import { hlc, memberId, NOW, rating, ratingId, title, titleId, day } from './fixtures.ts';

const A = titleId(0xa1); // manual row (larger id sorts after B below)
const B = titleId(0xa0);
const T = (p: Partial<TitleRow>, clocks: ClockedTitle['clocks'] = {}): ClockedTitle => ({ row: title({ tmdbId: 603, ...p }), clocks });
const R = (p: Parameters<typeof rating>[0], clocks: ClockedRating['clocks'] = {}): ClockedRating => ({ row: rating(p), clocks });
const cmd = (p: Partial<Extract<Command, { kind: 'ReconcileTitles' }>> = {}): Command => ({
  kind: 'ReconcileTitles', titleA: A, titleB: B, tmdbTitleId: null, ratingIds: [], ...p,
});
const run = (c: Command, s: ReconcileSnapshot) => decide({ reconcile: s }, c, NOW);
const changes = (c: Command, s: ReconcileSnapshot) => {
  const r = run(c, s);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.changes;
};

describe('ReconcileTitles survivor', () => {
  it('the row whose id is the TMDB-derived id survives', () => {
    const c = changes(cmd({ tmdbTitleId: A }), { first: T({ id: A }), second: T({ id: B }), ratings: [] });
    expect(c).toEqual([{ tbl: 'titles', rowId: B, fields: { merged_into: A } }]);
  });
  it('otherwise the smaller id survives, whatever the argument order', () => {
    const s = { first: T({ id: A }), second: T({ id: B }), ratings: [] };
    const swapped = { first: s.second, second: s.first, ratings: [] };
    expect(changes(cmd(), s)).toEqual([{ tbl: 'titles', rowId: A, fields: { merged_into: B } }]);
    expect(changes(cmd({ titleA: B, titleB: A }), swapped)).toEqual(changes(cmd(), s));
  });
});

describe('ReconcileTitles fields by greater HLC', () => {
  const survivorIsB = (loser: ClockedTitle, survivor: ClockedTitle) => changes(cmd(), { first: loser, second: survivor, ratings: [] });
  it('Link would duplicate: keeps the status that was changed most recently', () => {
    const loser = T({ id: A, status: 'watched', watchedOn: day('2026-09-10') }, { status: hlc(500), watched_on: hlc(500) });
    const survivor = T({ id: B, status: 'later' }, { status: hlc(100), watched_on: hlc(100) });
    const c = survivorIsB(loser, survivor);
    expect(c[0]).toEqual({ tbl: 'titles', rowId: B, fields: { status: 'watched', watched_on: '2026-09-10' } });
    expect(c[c.length - 1]).toEqual({ tbl: 'titles', rowId: A, fields: { merged_into: B } });
  });
  it('keeps the survivor value when it is newer', () => {
    const loser = T({ id: A, status: 'watched', watchedOn: day('2026-09-10') }, { status: hlc(100), watched_on: hlc(100) });
    const survivor = T({ id: B, status: 'later' }, { status: hlc(500), watched_on: hlc(500) });
    expect(survivorIsB(loser, survivor)).toEqual([{ tbl: 'titles', rowId: A, fields: { merged_into: B } }]);
  });
  it('each field independently: season from one row, status from the other', () => {
    const loser = T({ id: A, currentSeason: 2, status: 'later' }, { current_season: hlc(500), status: hlc(100) });
    const survivor = T({ id: B, currentSeason: 1, status: 'watching' }, { current_season: hlc(200), status: hlc(300) });
    expect(survivorIsB(loser, survivor)[0]).toEqual({ tbl: 'titles', rowId: B, fields: { current_season: 2 } });
  });
  it('a field the loser never wrote (no clock) is not copied; a survivor without a clock takes the loser value', () => {
    const loser = T({ id: A, year: 1999, runtimeMin: 100 }, { runtime_min: hlc(5) });
    const survivor = T({ id: B, year: 2000, runtimeMin: null }, {});
    expect(survivorIsB(loser, survivor)[0]).toEqual({ tbl: 'titles', rowId: B, fields: { runtime_min: 100 } });
  });
  it('genres compare and copy as JSON', () => {
    const loser = T({ id: A, genres: ['Drama'] }, { genres: hlc(9) });
    const survivor = T({ id: B, genres: null }, { genres: hlc(1) });
    expect(survivorIsB(loser, survivor)[0]!.fields).toEqual({ genres: '["Drama"]' });
  });
  it('removal is a field too: a newer tombstone on the loser carries over', () => {
    const loser = T({ id: A, deletedAt: NOW }, { deleted_at: hlc(9) });
    const survivor = T({ id: B }, { deleted_at: hlc(1) });
    expect(survivorIsB(loser, survivor)[0]!.fields).toEqual({ deleted_at: NOW });
  });
  it('equal values produce no copy even when the loser clock is newer', () => {
    const loser = T({ id: A, year: 1979 }, { year: hlc(9) });
    const survivor = T({ id: B, year: 1979 }, { year: hlc(1) });
    expect(survivorIsB(loser, survivor)).toHaveLength(1);
  });
});

describe('ReconcileTitles ratings', () => {
  const titles = { first: T({ id: A }), second: T({ id: B }) };
  it('Link keeps each member\'s most recent verdict: copies a newer loser verdict onto the survivor rating', () => {
    const ratings = [
      R({ id: ratingId(1), titleId: A, memberId: memberId(1), verdict: 'dislike', updatedAt: '2026-09-05T00:00:00.000Z' as never }, { verdict: hlc(500) }),
      R({ id: ratingId(2), titleId: B, memberId: memberId(1), verdict: 'like' }, { verdict: hlc(100) }),
    ];
    const c = changes(cmd(), { ...titles, ratings });
    expect(c[0]).toEqual({ tbl: 'ratings', rowId: ratingId(2), fields: { verdict: 'dislike', updated_at: '2026-09-05T00:00:00.000Z' } });
  });
  it('keeps the survivor verdict when it is newer, and per-field: review from loser, verdict from survivor', () => {
    const ratings = [
      R({ id: ratingId(1), titleId: A, memberId: memberId(1), verdict: 'dislike', review: 'meh film' as never }, { verdict: hlc(100), review: hlc(500) }),
      R({ id: ratingId(2), titleId: B, memberId: memberId(1), verdict: 'like' }, { verdict: hlc(300) }),
    ];
    const c = changes(cmd(), { ...titles, ratings });
    expect(c[0]!.fields).toMatchObject({ review: 'meh film' });
    expect(c[0]!.fields).not.toHaveProperty('verdict');
  });
  it('a member with a rating only on the loser gets an insert under the supplied derived id', () => {
    const ratings = [R({ id: ratingId(1), titleId: A, memberId: memberId(2), verdict: 'like' }, { verdict: hlc(7) })];
    const c = changes(cmd({ ratingIds: [{ titleId: B, memberId: memberId(2), ratingId: ratingId(9) }] }), { ...titles, ratings });
    expect(c[0]).toEqual({
      tbl: 'ratings', rowId: ratingId(9),
      fields: { title_id: B, member_id: memberId(2), verdict: 'like', updated_at: '2026-09-02T10:00:00.000Z' },
    });
  });
  it('rejects when a needed derived rating id is missing', () => {
    const ratings = [R({ id: ratingId(1), titleId: A, memberId: memberId(2), verdict: 'like' }, { verdict: hlc(7) })];
    expect(run(cmd(), { ...titles, ratings }).ok).toBe(false);
  });
  it('rating changes are ordered by member id', () => {
    const ratings = [
      R({ id: ratingId(1), titleId: A, memberId: memberId(3), verdict: 'like' }, { verdict: hlc(7) }),
      R({ id: ratingId(2), titleId: A, memberId: memberId(2), verdict: 'meh' }, { verdict: hlc(7) }),
    ];
    const ids = [{ titleId: B, memberId: memberId(2), ratingId: ratingId(8) }, { titleId: B, memberId: memberId(3), ratingId: ratingId(9) }];
    expect(changes(cmd({ ratingIds: ids }), { ...titles, ratings }).slice(0, 2).map((c) => c.rowId)).toEqual([ratingId(8), ratingId(9)]);
  });
});

describe('ReconcileTitles determinism and idempotence', () => {
  const snap = (): ReconcileSnapshot => ({
    first: T({ id: A, status: 'watched', watchedOn: day('2026-09-10'), year: 1999 }, { status: hlc(500), watched_on: hlc(500), year: hlc(1) }),
    second: T({ id: B, status: 'later', year: 2000 }, { status: hlc(100), year: hlc(2) }),
    ratings: [
      R({ id: ratingId(1), titleId: A, memberId: memberId(2), verdict: 'like' }, { verdict: hlc(7) }),
      R({ id: ratingId(2), titleId: A, memberId: memberId(1), verdict: 'meh' }, { verdict: hlc(8) }),
    ],
  });
  const ids = [{ titleId: B, memberId: memberId(1), ratingId: ratingId(8) }, { titleId: B, memberId: memberId(2), ratingId: ratingId(9) }];
  it('same inputs give identical changes, regardless of the order ratings are listed or of now', () => {
    const s = snap();
    const a = decide({ reconcile: s }, cmd({ ratingIds: ids }), NOW);
    const b = decide({ reconcile: { ...s, ratings: [...s.ratings].reverse() } }, cmd({ ratingIds: [...ids].reverse() }), '2030-01-01T00:00:00.000Z' as never);
    expect(b).toEqual(a);
  });
  it('a loser already merged_into the survivor yields no merged_into change again', () => {
    const s = snap();
    const merged: ReconcileSnapshot = { ...s, first: T({ id: A, mergedInto: B }), ratings: [] };
    expect(changes(cmd(), merged).some((c) => 'merged_into' in c.fields)).toBe(false);
  });
});

describe('ReconcileTitles rejections', () => {
  const ok2 = { first: T({ id: A }), second: T({ id: B }), ratings: [] };
  it('needs both rows, distinct ids, the same kind and the same non-null tmdb_id', () => {
    expect(run(cmd(), { ...ok2, second: null }).ok).toBe(false);
    expect(run(cmd({ titleB: A }), ok2).ok).toBe(false);
    expect(run(cmd(), { ...ok2, second: T({ id: B, kind: 'series' }) }).ok).toBe(false);
    expect(run(cmd(), { ...ok2, second: T({ id: B, tmdbId: 1 }) }).ok).toBe(false);
    expect(run(cmd(), { ...ok2, first: T({ id: A, tmdbId: null }), second: T({ id: B, tmdbId: null }) }).ok).toBe(false);
  });
  it('rejects a row already merged into a third title', () => {
    expect(run(cmd(), { ...ok2, first: T({ id: A, mergedInto: titleId(77) }) }).ok).toBe(false);
  });
  it('rejects without a snapshot', () => {
    expect(decide({}, cmd(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});
