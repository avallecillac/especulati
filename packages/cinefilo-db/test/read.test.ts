import { describe, expect, it } from 'vitest';
import { addManual, ANA, BEN, openTestDb, rate, seedMembers, ratingIdOf, uuid, type TestDb } from './helpers.ts';

/** A device acting as `as`; the partner's ratings are written by flipping meta.member_id on the same DB. */
function actAs(t: TestDb, id: string): void {
  t.db.setMeta('member_id', id);
}

describe('lists (3.3)', () => {
  it('Watch later: newest added first; Watching; Watched (watched and dropped): the numbered history newest first, then the rest', () => {
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
    expect(t.db.list('watched').map((i) => i.id)).toEqual([d, c, x]); // the numbered history newest first (d is #2, c is #1), then the dropped series
    expect(t.db.list('watched').find((i) => i.id === x)?.status).toBe('dropped');
  });

  it('excludes removed and merged rows, and a removed title keeps its ratings for a restore', () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const keep = addManual(t, 'Keep');
    const gone = addManual(t, 'Gone');
    rate(t, gone, 9, 'great');
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
    expect(detail.ratings.find((r) => r.mine)).toMatchObject({ stars: 9, review: 'great', name: 'Ana' });
  });

  it('shows both members\' stars in the list, half stars as 1..10, with no filter argument', () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const split = addManual(t, 'Split', { status: 'watched', watchedOn: '2026-01-02' });
    const mine = addManual(t, 'Mine only', { status: 'watched', watchedOn: '2026-01-03' });
    const none = addManual(t, 'None', { status: 'watched', watchedOn: '2026-01-05' });
    const as = (who: string, id: string, v: number) => { actAs(t, who); rate(t, id, v); };
    as(ANA, split, 9); as(BEN, split, 1);
    as(ANA, mine, 10);
    actAs(t, ANA);
    const items = t.db.list('watched');
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.id === split)).toMatchObject({ mine: 9, partner: 1 });
    expect(items.find((i) => i.id === mine)).toMatchObject({ mine: 10, partner: null });
    expect(items.find((i) => i.id === none)).toMatchObject({ mine: null, partner: null });
    actAs(t, BEN);
    expect(t.db.list('watched').find((i) => i.id === split)).toMatchObject({ mine: 1, partner: 9 });
  });

  it('an old verdict alone reads as not rated; a review still counts as reviewed', () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const id = addManual(t, 'Film');
    const other = addManual(t, 'Other');
    t.raw.exec(`INSERT INTO ratings (id, title_id, member_id, verdict, updated_at) VALUES ('${ratingIdOf(id, ANA)}', '${id}', '${ANA}', 'like', 'u'), ('${ratingIdOf(id, BEN)}', '${id}', '${BEN}', 'dislike', 'u')`);
    t.raw.exec(`INSERT INTO ratings (id, title_id, member_id, verdict, review, updated_at) VALUES ('${ratingIdOf(other, BEN)}', '${other}', '${BEN}', 'like', 'nice', 'u')`);
    const item = t.db.list('later').find((i) => i.id === id)!;
    expect(item).toMatchObject({ mine: null, partner: null, reviewedByMe: false, reviewedByPartner: false });
    expect(t.db.list('later').find((i) => i.id === other)).toMatchObject({ mine: null, partner: null, reviewedByPartner: true });
    const d = t.db.title(id)!;
    expect(d.ratings.map((r) => r.stars)).toEqual([null, null]);
    expect(d.ratings.every((r) => !('verdict' in r))).toBe(true);
  });

  it('cleared stars read as not rated, and a removed member drops out', () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const id = addManual(t, 'Film');
    rate(t, id, 9);
    rate(t, id, null);
    expect(t.db.list('later')[0]).toMatchObject({ mine: null, partner: null });
    actAs(t, BEN);
    rate(t, id, 6);
    actAs(t, ANA);
    expect(t.db.list('later')[0]!.partner).toBe(6);
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
    rate(t, id, 9, 'loved it');
    actAs(t, BEN);
    const d = t.db.title(id)!;
    expect(d.ratings).toEqual([
      { memberId: BEN, name: 'Ben', stars: null, review: null, mine: true },
      { memberId: ANA, name: 'Ana', stars: 9, review: 'loved it', mine: false },
    ]);
    expect(ratingIdOf(id, ANA)).toBeTruthy();
    expect(t.db.title(uuid(0x999))).toBeNull();
  });
});
