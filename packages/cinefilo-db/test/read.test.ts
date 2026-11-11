import { describe, expect, it } from 'vitest';
import { addManual, ANA, BEN, openTestDb, rate, seedMembers, ratingIdOf, uuid, type TestDb } from './helpers.ts';

/** A device acting as `as`; the partner's ratings are written by flipping meta.member_id on the same DB. */
function actAs(t: TestDb, id: string): void {
  t.db.setMeta('member_id', id);
}

describe('lists (3.3)', () => {
  it('Watch later: newest added first; Watching; Watched (watched and dropped): most recently watched first', () => {
    const t = openTestDb();
    seedMembers(t);
    const a = addManual(t, 'Alpha');
    const b = addManual(t, 'Bravo');
    const s = addManual(t, 'Series One', { mediaKind: 'series' });
    const c = addManual(t, 'Charlie', { status: 'watched', watchedOn: '2026-01-02' });
    const d = addManual(t, 'Delta', { status: 'watched', watchedOn: '2026-03-01' });
    t.tick();
    expect(t.db.dispatch({ kind: 'SetStatus', titleId: s, status: 'watching' }, t.env).ok).toBe(true);
    const x = addManual(t, 'Dropped Show', { mediaKind: 'series' });
    expect(t.db.dispatch({ kind: 'SetStatus', titleId: x, status: 'dropped', watchedOn: '2026-02-01' }, t.env).ok).toBe(true);

    expect(t.db.list('later').map((i) => i.id)).toEqual([b, a]);
    expect(t.db.list('watching').map((i) => i.id)).toEqual([s]);
    expect(t.db.list('watched').map((i) => i.id)).toEqual([d, x, c]);
    expect(t.db.list('watched').find((i) => i.id === x)?.status).toBe('dropped');
  });

  it('excludes removed and merged rows, and a removed title keeps its ratings for a restore', () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const keep = addManual(t, 'Keep');
    const gone = addManual(t, 'Gone');
    rate(t, gone, 'like', 'great');
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveTitle', titleId: gone }, t.env).ok).toBe(true);
    expect(t.db.list('later').map((i) => i.id)).toEqual([keep]);
    expect(t.db.title(gone)).toBeNull();
    expect(t.raw.selectValue('SELECT COUNT(*) FROM ratings WHERE title_id = ?', [gone])).toBe(1);

    const other = addManual(t, 'Other');
    t.raw.exec(`UPDATE titles SET merged_into = '${keep}' WHERE id = '${other}'`);
    expect(t.db.list('later').map((i) => i.id)).toEqual([keep]);
    expect(t.db.title(other)).toBeNull();

    t.tick();
    expect(t.db.dispatch({ kind: 'RestoreTitle', titleId: gone }, t.env).ok).toBe(true);
    const detail = t.db.title(gone)!;
    expect(detail.ratings.find((r) => r.mine)).toMatchObject({ verdict: 'like', review: 'great', name: 'Ana' });
  });

  it('shows both members verdicts and applies the five filters', () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const ids = {
      both: addManual(t, 'Both liked', { status: 'watched', watchedOn: '2026-01-01' }),
      split: addManual(t, 'Split', { status: 'watched', watchedOn: '2026-01-02' }),
      mine: addManual(t, 'Mine only', { status: 'watched', watchedOn: '2026-01-03' }),
      theirs: addManual(t, 'Theirs only', { status: 'watched', watchedOn: '2026-01-04' }),
      none: addManual(t, 'None', { status: 'watched', watchedOn: '2026-01-05' }),
    };
    const as = (who: string, id: string, v: 'like' | 'meh' | 'dislike') => { actAs(t, who); rate(t, id, v); };
    as(ANA, ids.both, 'like'); as(BEN, ids.both, 'like');
    as(ANA, ids.split, 'like'); as(BEN, ids.split, 'dislike');
    as(ANA, ids.mine, 'meh');
    as(BEN, ids.theirs, 'like');
    actAs(t, ANA);

    const f = (name: Parameters<typeof t.db.list>[1]) => t.db.list('watched', name).map((i) => i.id).sort();
    expect(f('bothLiked')).toEqual([ids.both]);
    expect(f('disagree')).toEqual([ids.split]);
    expect(f('onlyMe')).toEqual([ids.mine]);
    expect(f('partnerNotRated')).toEqual([ids.mine, ids.none].sort());
    expect(f('nobody')).toEqual([ids.none]);
    expect(t.db.list('watched')).toHaveLength(5);
    expect(t.db.list('watched').find((i) => i.id === ids.split)).toMatchObject({ mine: 'like', partner: 'dislike' });
  });

  it('a cleared verdict reads as not rated, and a removed member drops out', () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const id = addManual(t, 'Film');
    rate(t, id, 'like');
    rate(t, id, null);
    expect(t.db.list('later')[0]).toMatchObject({ mine: null, partner: null });
    actAs(t, BEN);
    rate(t, id, 'meh');
    actAs(t, ANA);
    expect(t.db.list('later')[0]!.partner).toBe('meh');
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveMember', memberId: BEN }, t.env).ok).toBe(true);
    expect(t.db.list('later')[0]!.partner).toBeNull();
    expect(t.db.members().map((m) => m.name)).toEqual(['Ana']);
  });
});

describe('title detail (3.3)', () => {
  it('has a column per live member, mine first, with names and not-rated placeholders', () => {
    const t = openTestDb(1, BEN);
    seedMembers(t, BEN);
    const id = addManual(t, 'Film');
    actAs(t, ANA);
    rate(t, id, 'like', 'loved it');
    actAs(t, BEN);
    const d = t.db.title(id)!;
    expect(d.ratings).toEqual([
      { memberId: BEN, name: 'Ben', verdict: null, review: null, mine: true },
      { memberId: ANA, name: 'Ana', verdict: 'like', review: 'loved it', mine: false },
    ]);
    expect(ratingIdOf(id, ANA)).toBeTruthy();
    expect(t.db.title(uuid(0x999))).toBeNull();
  });
});
