import { describe, expect, it } from 'vitest';
import { decide, type ClockedMemberStatus, type ClockedRecommendation, type ClockedTitle, type Command, type ReconcileSnapshot, type TitleRow } from '../src/index.ts';
import { hlc, memberId, memberStatus, msId, NOW, recId, recommendation, title, titleId } from './fixtures.ts';

const A = titleId(0xa1); // loser (larger id)
const B = titleId(0xa0); // survivor
const T = (p: Partial<TitleRow>, clocks: ClockedTitle['clocks'] = {}): ClockedTitle => ({ row: title({ tmdbId: 603, ...p }), clocks });
const MS = (p: Parameters<typeof memberStatus>[0], clocks: ClockedMemberStatus['clocks'] = {}): ClockedMemberStatus => ({ row: memberStatus(p), clocks });
const RC = (p: Parameters<typeof recommendation>[0], clocks: ClockedRecommendation['clocks'] = {}): ClockedRecommendation => ({ row: recommendation(p), clocks });
const cmd = (p: Partial<Extract<Command, { kind: 'ReconcileTitles' }>> = {}): Command => ({
  kind: 'ReconcileTitles', titleA: A, titleB: B, tmdbTitleId: null, ratingIds: [], ...p,
});
const changes = (c: Command, s: ReconcileSnapshot) => {
  const r = decide({ reconcile: s }, c, NOW);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.changes;
};
const pair = { first: T({ id: A }), second: T({ id: B }) };
const M1 = memberId(1);
const MERGE = { tbl: 'titles', rowId: B, fields: { merged_into: A } } as const;
// survivor = smaller id = B; loser = A
const LOSE = { tbl: 'titles', rowId: A, fields: { merged_into: B } } as const;
void MERGE;

describe('ReconcileTitles carries member_status (D3)', () => {
  it('a personal status on the loser moves onto the survivor under the derived id', () => {
    const loser = MS({ id: msId(1), titleId: A, memberId: M1, status: 'watching', currentSeason: 2 }, { status: hlc(10), watched_on: hlc(10), current_season: hlc(11) });
    const c = changes(cmd({ memberStatusIds: [{ titleId: B, memberId: M1, id: msId(2) }] }), { ...pair, ratings: [], memberStatuses: [loser] });
    expect(c).toEqual([
      { tbl: 'member_status', rowId: msId(2), fields: { status: 'watching', watched_on: null, current_season: 2, title_id: B, member_id: M1, updated_at: loser.row.updatedAt } },
      LOSE,
    ]);
  });
  it('per field by greater HLC against an existing survivor row', () => {
    const loser = MS({ id: msId(1), titleId: A, memberId: M1, status: 'watched', currentSeason: 3 }, { status: hlc(500), current_season: hlc(100) });
    const survivor = MS({ id: msId(2), titleId: B, memberId: M1, status: 'later', currentSeason: 1 }, { status: hlc(100), current_season: hlc(500) });
    expect(changes(cmd(), { ...pair, ratings: [], memberStatuses: [survivor, loser] })).toEqual([
      { tbl: 'member_status', rowId: msId(2), fields: { status: 'watched' } },
      LOSE,
    ]);
  });
  it('a removed loser row is not carried; a missing derived id is an input error', () => {
    const gone = MS({ id: msId(1), titleId: A, memberId: M1, deletedAt: NOW }, { status: hlc(10) });
    expect(changes(cmd(), { ...pair, ratings: [], memberStatuses: [gone] })).toEqual([LOSE]);
    const live = MS({ id: msId(1), titleId: A, memberId: M1 }, { status: hlc(10) });
    expect(decide({ reconcile: { ...pair, ratings: [], memberStatuses: [live] } }, cmd(), NOW).ok).toBe(false);
  });
  it('deterministic: input order does not matter, and a second pass writes nothing more', () => {
    const l1 = MS({ id: msId(1), titleId: A, memberId: memberId(1), status: 'later' }, { status: hlc(10) });
    const l2 = MS({ id: msId(3), titleId: A, memberId: memberId(2), status: 'watched' }, { status: hlc(10) });
    const ids = [{ titleId: B, memberId: memberId(1), id: msId(4) }, { titleId: B, memberId: memberId(2), id: msId(5) }];
    const a = changes(cmd({ memberStatusIds: ids }), { ...pair, ratings: [], memberStatuses: [l1, l2] });
    const b = changes(cmd({ memberStatusIds: [...ids].reverse() }), { ...pair, ratings: [], memberStatuses: [l2, l1] });
    expect(b).toEqual(a);
    const after = [
      { row: memberStatus({ id: msId(4), titleId: B, memberId: memberId(1), status: 'later' }), clocks: { status: hlc(10) } },
      { row: memberStatus({ id: msId(5), titleId: B, memberId: memberId(2), status: 'watched' }), clocks: { status: hlc(10) } },
    ];
    const again = changes(cmd(), { first: pair.first, second: { ...pair.second, row: { ...pair.second.row, } }, ratings: [], memberStatuses: [...after, l1, l2] });
    expect(again.filter((x) => x.tbl === 'member_status')).toEqual([]);
  });
});

describe('ReconcileTitles carries recommendations (D3)', () => {
  it('moves a loser recommendation onto the survivor', () => {
    const loser = RC({ id: recId(1), titleId: A, answered: 'dismissed', answeredAt: NOW }, { answered: hlc(20), answered_at: hlc(20) });
    const c = changes(cmd({ recommendationIds: [{ titleId: B, fromMember: memberId(1), toMember: memberId(2), id: recId(2) }] }), { ...pair, ratings: [], recommendations: [loser] });
    expect(c).toEqual([
      { tbl: 'recommendations', rowId: recId(2), fields: { answered: 'dismissed', answered_at: NOW, title_id: B, from_member: memberId(1), to_member: memberId(2), created_at: loser.row.createdAt } },
      LOSE,
    ]);
  });
  it('merges the two single-writer sides field by field', () => {
    const loser = RC({ id: recId(1), titleId: A, withdrawnAt: NOW }, { withdrawn_at: hlc(300) });
    const survivor = RC({ id: recId(2), titleId: B, answered: 'accepted', answeredAt: NOW }, { answered: hlc(100), answered_at: hlc(100) });
    expect(changes(cmd(), { ...pair, ratings: [], recommendations: [survivor, loser] })).toEqual([
      { tbl: 'recommendations', rowId: recId(2), fields: { withdrawn_at: NOW } },
      LOSE,
    ]);
  });
  it('a recommendation with no clocked fields and an unchanged survivor writes nothing', () => {
    const loser = RC({ id: recId(1), titleId: A });
    const survivor = RC({ id: recId(2), titleId: B });
    expect(changes(cmd(), { ...pair, ratings: [], recommendations: [survivor, loser] })).toEqual([LOSE]);
  });
});

describe('ReconcileTitles and a title that is not on Together', () => {
  it('a null Together status never replaces a real one, even when newer', () => {
    const loser = T({ id: A, status: null }, { status: hlc(900), watched_on: hlc(900) });
    const survivor = T({ id: B, status: 'watched', watchedOn: '2026-09-01' as never }, { status: hlc(100), watched_on: hlc(100) });
    expect(changes(cmd(), { first: loser, second: survivor, ratings: [] })).toEqual([LOSE]);
  });
  it('a real status fills a survivor that is not on Together, with its date', () => {
    const loser = T({ id: A, status: 'watched', watchedOn: '2026-09-01' as never }, { status: hlc(100), watched_on: hlc(100) });
    const survivor = T({ id: B, status: null }, { status: hlc(900) });
    expect(changes(cmd(), { first: loser, second: survivor, ratings: [] })[0]).toEqual({ tbl: 'titles', rowId: B, fields: { status: 'watched', watched_on: '2026-09-01' } });
  });
  it('two titles that are both off Together change nothing but the merge', () => {
    expect(changes(cmd(), { first: T({ id: A, status: null }, { status: hlc(5) }), second: T({ id: B, status: null }, { status: hlc(6) }), ratings: [] })).toEqual([LOSE]);
  });
});
