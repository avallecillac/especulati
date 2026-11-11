import { describe, expect, it } from 'vitest';
import { decide, type Command, type Snapshot } from '../src/index.ts';
import { member, memberId, memberStatus, msId, NOW, recId, recommendation, title, titleId, day } from './fixtures.ts';

const run = (cmd: Command, snap: Snapshot) => decide(snap, cmd, NOW);
const ME = memberId(1);
const PARTNER = memberId(2);
const base: Snapshot = { title: title(), member: member(), memberStatus: null, deviceMemberId: ME };
const changes = (cmd: Command, snap: Snapshot) => {
  const r = run(cmd, snap);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.changes;
};
const mine = (status: string | null, p = {}): Command => ({ kind: 'SetMyStatus', titleId: titleId(1), memberId: ME, memberStatusId: msId(1), status: status as never, ...p });
const series = title({ kind: 'series', seasonCount: 3 });

describe('SetMyStatus', () => {
  it('Watch solo: first write inserts the member_status row and touches nothing else (Together unchanged)', () => {
    expect(changes(mine('watching'), { ...base, title: series })).toEqual([
      { tbl: 'member_status', rowId: msId(1), fields: { title_id: titleId(1), member_id: ME, status: 'watching', watched_on: null, updated_at: NOW } },
    ]);
  });
  it('later edits carry only what changes', () => {
    expect(changes(mine('later'), { ...base, memberStatus: memberStatus({ status: 'watching' }) })).toEqual([
      { tbl: 'member_status', rowId: msId(1), fields: { status: 'later', watched_on: null, updated_at: NOW } },
    ]);
  });
  it('watched takes an optional date; later and watching clear it', () => {
    expect(changes(mine('watched', { watchedOn: '2026-09-20' }), base)[0]!.fields).toMatchObject({ status: 'watched', watched_on: '2026-09-20' });
    expect(changes(mine('watched'), base)[0]!.fields).toMatchObject({ status: 'watched', watched_on: null });
    expect(changes(mine('later', { watchedOn: '2026-09-20' }), base)[0]!.fields).toMatchObject({ watched_on: null });
  });
  it('null takes the title off my list', () => {
    expect(changes(mine(null), { ...base, memberStatus: memberStatus() })[0]!.fields).toEqual({ status: null, watched_on: null, updated_at: NOW });
  });
  it('rejects watching for a movie, dropped, bad dates and unknown statuses', () => {
    expect(run(mine('watching'), base).ok).toBe(false);
    expect(run(mine('dropped'), { ...base, title: series }).ok).toBe(false);
    expect(run(mine('watched', { watchedOn: '2026-02-30' }), base).ok).toBe(false);
    expect(run(mine('done'), base).ok).toBe(false);
  });
  it("Partner's list is read-only: NotYourList", () => {
    expect(run(mine('later', { memberId: PARTNER }), { ...base, member: member({ id: PARTNER }) })).toEqual({ ok: false, error: { kind: 'NotYourList' } });
    expect(run(mine('later'), { ...base, deviceMemberId: null })).toEqual({ ok: false, error: { kind: 'NotYourList' } });
  });
  it('rejects an unknown member and a missing, removed or merged title', () => {
    expect(run(mine('later'), { ...base, member: null })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
    for (const t of [null, title({ deletedAt: NOW }), title({ mergedInto: titleId(2) })]) {
      expect(run(mine('later'), { ...base, title: t })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    }
  });
  it('a title that is not on Together (status null) can still be put on my list', () => {
    expect(run(mine('later'), { ...base, title: title({ status: null }) }).ok).toBe(true);
  });
});

describe('SetMySeason', () => {
  const season = (n: number, p = {}): Command => ({ kind: 'SetMySeason', titleId: titleId(1), memberId: ME, memberStatusId: msId(1), season: n, ...p });
  it('my own season, separate from the Together season', () => {
    expect(changes(season(2), { ...base, title: series, memberStatus: memberStatus({ status: 'watching' }) })).toEqual([
      { tbl: 'member_status', rowId: msId(1), fields: { current_season: 2, updated_at: NOW } },
    ]);
  });
  it('first write inserts the key', () => {
    expect(changes(season(2), { ...base, title: series })[0]!.fields).toMatchObject({ title_id: titleId(1), member_id: ME, current_season: 2 });
  });
  it('series only, within 1 and the season count', () => {
    expect(run(season(1), base)).toEqual({ ok: false, error: { kind: 'NotASeries' } });
    expect(run(season(0), { ...base, title: series })).toEqual({ ok: false, error: { kind: 'SeasonOutOfRange', max: 3 } });
    expect(run(season(4), { ...base, title: series })).toEqual({ ok: false, error: { kind: 'SeasonOutOfRange', max: 3 } });
  });
  it('NotYourList for the partner', () => {
    expect(run(season(1, { memberId: PARTNER }), { ...base, title: series, member: member({ id: PARTNER }) })).toEqual({ ok: false, error: { kind: 'NotYourList' } });
  });
});

describe('Recommend', () => {
  const rec = (p = {}): Command => ({ kind: 'Recommend', titleId: titleId(1), fromMember: ME, toMember: PARTNER, recommendationId: recId(1), ...p });
  const snap: Snapshot = { title: title(), member: member({ id: PARTNER }), recommendation: null, deviceMemberId: ME };
  it('inserts a recommendation from me to my partner', () => {
    expect(changes(rec(), snap)).toEqual([
      { tbl: 'recommendations', rowId: recId(1), fields: { title_id: titleId(1), from_member: ME, to_member: PARTNER, created_at: NOW } },
    ]);
  });
  it('cannot recommend to oneself', () => {
    expect(run(rec({ toMember: ME }), { ...snap, member: member() }).ok).toBe(false);
  });
  it('only as the device member: NotYours', () => {
    expect(run(rec({ fromMember: PARTNER, toMember: ME }), { ...snap, member: member() })).toEqual({ ok: false, error: { kind: 'NotYours' } });
    expect(run(rec(), { ...snap, deviceMemberId: null })).toEqual({ ok: false, error: { kind: 'NotYours' } });
  });
  it('the recipient must be a live member; the title must exist', () => {
    expect(run(rec(), { ...snap, member: null })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
    expect(run(rec(), { ...snap, member: member({ id: PARTNER, deletedAt: NOW }) })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
    expect(run(rec(), { ...snap, title: null })).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
  it('an open recommendation is not repeated; an answered one stays answered', () => {
    expect(run(rec(), { ...snap, recommendation: recommendation() })).toEqual({ ok: false, error: { kind: 'AlreadyExists', id: recId(1) } });
    expect(run(rec(), { ...snap, recommendation: recommendation({ answered: 'dismissed', answeredAt: NOW }) })).toEqual({ ok: false, error: { kind: 'AlreadyExists', id: recId(1) } });
  });
  it('a withdrawn one is re-sent by clearing withdrawn_at (a field only the recommender writes)', () => {
    expect(changes(rec(), { ...snap, recommendation: recommendation({ withdrawnAt: NOW }) })).toEqual([
      { tbl: 'recommendations', rowId: recId(1), fields: { withdrawn_at: null, created_at: NOW } },
    ]);
  });
});

describe('WithdrawRecommendation', () => {
  const wd = (): Command => ({ kind: 'WithdrawRecommendation', id: recId(1) });
  it('the recommender withdraws', () => {
    expect(changes(wd(), { recommendation: recommendation(), deviceMemberId: ME })).toEqual([{ tbl: 'recommendations', rowId: recId(1), fields: { withdrawn_at: NOW } }]);
  });
  it('nobody else: NotYours', () => {
    expect(run(wd(), { recommendation: recommendation(), deviceMemberId: PARTNER })).toEqual({ ok: false, error: { kind: 'NotYours' } });
    expect(run(wd(), { recommendation: recommendation(), deviceMemberId: null })).toEqual({ ok: false, error: { kind: 'NotYours' } });
  });
  it('NotFound when absent or removed; idempotent when already withdrawn or answered', () => {
    expect(run(wd(), { recommendation: null, deviceMemberId: ME })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(run(wd(), { recommendation: recommendation({ deletedAt: NOW }), deviceMemberId: ME })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(run(wd(), { recommendation: recommendation({ withdrawnAt: NOW }), deviceMemberId: ME })).toEqual({ ok: true, value: { changes: [] } });
    expect(run(wd(), { recommendation: recommendation({ answered: 'accepted', answeredAt: NOW }), deviceMemberId: ME })).toEqual({ ok: true, value: { changes: [] } });
  });
});

describe('AnswerRecommendation', () => {
  const answer = (a: string, p = {}): Command => ({ kind: 'AnswerRecommendation', id: recId(1), titleId: titleId(1), memberId: PARTNER, memberStatusId: msId(2), answer: a as never, ...p });
  const snap: Snapshot = { title: title(), recommendation: recommendation(), memberStatus: null, deviceMemberId: PARTNER };
  it('Accept writes the answer and my Watch later in one decision', () => {
    expect(changes(answer('accepted'), snap)).toEqual([
      { tbl: 'recommendations', rowId: recId(1), fields: { answered: 'accepted', answered_at: NOW } },
      { tbl: 'member_status', rowId: msId(2), fields: { title_id: titleId(1), member_id: PARTNER, status: 'later', watched_on: null, updated_at: NOW } },
    ]);
  });
  it('Accept leaves an existing personal status alone', () => {
    expect(changes(answer('accepted'), { ...snap, memberStatus: memberStatus({ id: msId(2), memberId: PARTNER, status: 'watched' }) })).toEqual([
      { tbl: 'recommendations', rowId: recId(1), fields: { answered: 'accepted', answered_at: NOW } },
    ]);
  });
  it('Accept re-uses a member_status row that is off my list (status null)', () => {
    const c = changes(answer('accepted'), { ...snap, memberStatus: memberStatus({ id: msId(2), memberId: PARTNER, status: null }) });
    expect(c[1]).toEqual({ tbl: 'member_status', rowId: msId(2), fields: { status: 'later', watched_on: null, updated_at: NOW } });
  });
  it('Dismiss writes only the answer', () => {
    expect(changes(answer('dismissed'), snap)).toEqual([{ tbl: 'recommendations', rowId: recId(1), fields: { answered: 'dismissed', answered_at: NOW } }]);
  });
  it('only the recipient answers: NotYours', () => {
    expect(run(answer('dismissed', { memberId: ME }), { ...snap, deviceMemberId: ME })).toEqual({ ok: false, error: { kind: 'NotYours' } });
    expect(run(answer('dismissed'), { ...snap, deviceMemberId: ME })).toEqual({ ok: false, error: { kind: 'NotYours' } });
  });
  it('already answered is a no-op; withdrawn or missing is NotFound; a different title is invalid', () => {
    expect(run(answer('accepted'), { ...snap, recommendation: recommendation({ answered: 'dismissed', answeredAt: NOW }) })).toEqual({ ok: true, value: { changes: [] } });
    expect(run(answer('accepted'), { ...snap, recommendation: recommendation({ withdrawnAt: NOW }) })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(run(answer('accepted'), { ...snap, recommendation: null })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(run(answer('accepted', { titleId: titleId(9) }), snap).ok).toBe(false);
    expect(run(answer('maybe'), snap).ok).toBe(false);
  });
  it('accepting needs a live title; dismissing does not', () => {
    expect(run(answer('accepted'), { ...snap, title: title({ deletedAt: NOW }) })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(run(answer('dismissed'), { ...snap, title: null }).ok).toBe(true);
  });
});

describe('AddTitle to: me (D3)', () => {
  const add = (p = {}): Command => ({ kind: 'AddTitle', titleId: titleId(1), mediaKind: 'movie', title: 'Stalker', addedBy: ME, to: 'me', memberStatusId: msId(1), ...p });
  const snap: Snapshot = { title: null, memberStatus: null, deviceMemberId: ME };
  it('creates the title WITHOUT a Together status and sets my status', () => {
    expect(changes(add(), snap)).toEqual([
      { tbl: 'titles', rowId: titleId(1), fields: { kind: 'movie', title: 'Stalker', status: null, added_by: ME, created_at: NOW } },
      { tbl: 'member_status', rowId: msId(1), fields: { title_id: titleId(1), member_id: ME, status: 'later', watched_on: null, updated_at: NOW } },
    ]);
  });
  it('carries the chosen personal status and date', () => {
    const c = changes(add({ status: 'watched', watchedOn: '2026-09-20' }), snap);
    expect(c[1]!.fields).toMatchObject({ status: 'watched', watched_on: day('2026-09-20') });
    expect(c[0]!.fields).not.toHaveProperty('watched_on');
  });
  it('Already in the catalog: only a personal status, no duplicate and Together untouched', () => {
    expect(changes(add(), { ...snap, title: title({ status: 'later' }) })).toEqual([
      { tbl: 'member_status', rowId: msId(1), fields: { title_id: titleId(1), member_id: ME, status: 'later', watched_on: null, updated_at: NOW } },
    ]);
  });
  it('already on my list: AlreadyExists', () => {
    expect(run(add(), { ...snap, title: title(), memberStatus: memberStatus() })).toEqual({ ok: false, error: { kind: 'AlreadyExists', id: titleId(1) } });
  });
  it('a row that is off my list (status null) is put back on it', () => {
    expect(run(add(), { ...snap, title: title(), memberStatus: memberStatus({ status: null }) }).ok).toBe(true);
  });
  it('a removed title is revived without a Together status', () => {
    const c = changes(add(), { ...snap, title: title({ deletedAt: NOW }) });
    expect(c[0]).toMatchObject({ tbl: 'titles', fields: { deleted_at: null, status: null } });
  });
  it('only for the device member; needs the id; no dropped; no watching for a movie', () => {
    expect(run(add({ addedBy: PARTNER }), snap)).toEqual({ ok: false, error: { kind: 'NotYourList' } });
    expect(run(add({ memberStatusId: undefined }), snap).ok).toBe(false);
    expect(run(add({ status: 'dropped' }), snap).ok).toBe(false);
    expect(run(add({ status: 'watching' }), snap).ok).toBe(false);
  });
  it('a merged title answers AlreadyExists with the survivor', () => {
    expect(run(add(), { ...snap, title: title({ mergedInto: titleId(2) }) })).toEqual({ ok: false, error: { kind: 'AlreadyExists', id: titleId(2) } });
  });
});

describe('AddTitle to: together on a catalog-only title', () => {
  const add = (): Command => ({ kind: 'AddTitle', titleId: titleId(1), mediaKind: 'movie', title: 'Stalker', addedBy: ME, status: 'watched', watchedOn: '2026-09-20' });
  it('puts a title that is only on someone\'s list onto Together instead of AlreadyExists', () => {
    expect(changes(add(), { title: title({ status: null }) })).toEqual([
      { tbl: 'titles', rowId: titleId(1), fields: { status: 'watched', watched_on: '2026-09-20', watch_order: 1 } },
    ]);
  });
  it('an explicit to: together behaves like today', () => {
    expect(run({ ...add(), to: 'together' } as Command, { title: title({ status: 'later' }) })).toEqual({ ok: false, error: { kind: 'AlreadyExists', id: titleId(1) } });
  });
});
