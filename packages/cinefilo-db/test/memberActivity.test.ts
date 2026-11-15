import { describe, expect, it } from 'vitest';
import { ANA, BEN, addJustMe, addManual, openTestDb, rate, recIdOf, seedMembers, setMine } from './helpers.ts';

const as = (t: ReturnType<typeof openTestDb>, m: string) => t.db.setMeta('member_id', m);

function two() {
  const t = openTestDb(1, ANA);
  seedMembers(t, ANA);
  return t;
}

describe('memberActivity (cinefilo-member-cleanup D1)', () => {
  it('counts ratings, reviews, personal titles, recommendations and titles added per live member', () => {
    const t = two();
    const heat = addManual(t, 'Heat', { year: 1995 });
    const ran = addJustMe(t, 'Ran', { year: 1985 });
    rate(t, heat, 8, 'Great');
    rate(t, ran, 6);
    setMine(t, heat, 'later');
    as(t, BEN);
    rate(t, heat, 4);
    t.tick();
    expect(t.db.dispatch({ kind: 'Recommend', titleId: heat, fromMember: BEN, toMember: ANA, recommendationId: recIdOf(heat, BEN, ANA) }, t.env).ok).toBe(true);

    const a = t.db.memberActivity();
    expect(a.map((m) => m.id)).toEqual([BEN, ANA]); // the device's own first (as members())
    const ana = a.find((m) => m.id === ANA)!;
    expect(ana).toMatchObject({ name: 'Ana', me: false, ratings: 2, reviews: 1, personal: 2, recommendations: 1, titlesAdded: 2, total: 8 });
    const ben = a.find((m) => m.id === BEN)!;
    expect(ben).toMatchObject({ name: 'Ben', me: true, ratings: 1, reviews: 0, personal: 0, recommendations: 1, titlesAdded: 0, total: 2 });
  });

  it('ignores deleted and merged titles, and removed members are not listed', () => {
    const t = two();
    const heat = addManual(t, 'Heat', { year: 1995 });
    const gone = addManual(t, 'Gone', { year: 2000 });
    rate(t, heat, 8);
    rate(t, gone, 8, 'x');
    setMine(t, gone, 'later');
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveTitle', titleId: gone }, t.env).ok).toBe(true);
    const ana = t.db.memberActivity().find((m) => m.id === ANA)!;
    expect(ana).toMatchObject({ ratings: 1, reviews: 0, personal: 0, recommendations: 0, titlesAdded: 1, total: 2 });

    t.raw.exec(`UPDATE titles SET merged_into = '${heat}' WHERE id = '${heat}'`);
    expect(t.db.memberActivity().find((m) => m.id === ANA)).toMatchObject({ ratings: 0, titlesAdded: 0, total: 0 });

    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveMember', memberId: BEN }, t.env).ok).toBe(true);
    expect(t.db.memberActivity().map((m) => m.id)).toEqual([ANA]);
  });

  it('counts a rating that only has an old verdict, so duplicates from before stars can be told apart', () => {
    const t = two();
    const heat = addManual(t, 'Heat', { year: 1995 });
    rate(t, heat, 8);
    t.raw.exec("UPDATE ratings SET stars = NULL, verdict = 'like'");
    expect(t.db.memberActivity().find((m) => m.id === ANA)).toMatchObject({ ratings: 1 });
  });
});

describe('me() (cinefilo-member-cleanup D3)', () => {
  it('is the stored member, null before who-am-I, and null once that member is removed (meta untouched)', () => {
    const t = openTestDb(1, null);
    expect(t.db.me()).toBeNull();
    seedMembers(t, ANA);
    expect(t.db.me()).toBe(ANA);
    as(t, BEN);
    t.tick();
    t.db.dispatch({ kind: 'RemoveMember', memberId: BEN }, { ...t.env }); // acting as Ben: rejected
    expect(t.db.me()).toBe(BEN);
    as(t, ANA);
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveMember', memberId: BEN }, t.env).ok).toBe(true);
    as(t, BEN);
    expect(t.db.me()).toBeNull();
    expect(t.db.memberId).toBe(BEN);
  });
});
