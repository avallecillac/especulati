import { describe, expect, it } from 'vitest';
import { cinefiloSchema } from '@especulati/cinefilo-core';
import { exportText, importText } from '../src/index.ts';
import { ANA, addJustMe, addManual, BEN, dump, hashId, mstatusIdOf, openTestDb, rate, recIdOf, seedMembers, setMine, uuid, type TestDb } from './helpers.ts';

/** Two members seeded on one DB, switching the acting member (the same file models both phones for read-model tests). */
function two(): TestDb {
  const t = openTestDb(1, ANA);
  seedMembers(t, ANA);
  return t;
}
const as = (t: TestDb, m: string) => t.db.setMeta('member_id', m);
const recommend = (t: TestDb, titleId: string, from: string, to: string) => {
  as(t, from);
  t.tick();
  const r = t.db.dispatch({ kind: 'Recommend', titleId, fromMember: from, toMember: to, recommendationId: recIdOf(titleId, from, to) }, t.env);
  if (!r.ok) throw new Error(`recommend: ${r.error.kind}`);
};
const answer = (t: TestDb, recId: string, titleId: string, who: string, a: 'accepted' | 'dismissed') => {
  as(t, who);
  t.tick();
  return t.db.dispatch({ kind: 'AnswerRecommendation', id: recId, titleId, memberId: who, memberStatusId: mstatusIdOf(titleId, who), answer: a }, t.env);
};

describe('Together lists exclude titles that are not on Together (status NULL)', () => {
  it('a Just me title is in no Together tab, filter or backfill-excluded count, but is in the catalog', () => {
    const t = two();
    const together = addManual(t, 'Heat', { year: 1995 });
    const mine = addJustMe(t, 'Ran', { year: 1985 });
    for (const tab of ['later', 'watching', 'watched'] as const) {
      expect(t.db.list(tab).map((i) => i.id)).toEqual(tab === 'later' ? [together] : []);
      expect(t.db.list(tab).map((i) => i.id)).not.toContain(mine);
    }
    expect(t.raw.selectValue('SELECT status FROM titles WHERE id = ?', [mine])).toBeNull();
    expect(t.db.title(mine)?.title.status).toBeNull();
    expect(t.db.findByTmdb(1, 'movie')).toBeNull();
  });
  it('the backfill still sees a catalog-only title linked to TMDB that lacks details', () => {
    const t = two();
    const id = addJustMe(t, 'Ran', { year: 1985 });
    t.tick();
    t.db.dispatch({ kind: 'LinkToTmdb', titleId: id, tmdbId: 11645, details: {} }, t.env);
    expect(t.db.needsDetails().map((n) => n.id)).toEqual([id]);
    expect(t.db.findByTmdb(11645, 'movie')).toBe(id);
  });
  it('adding it to Together later sets the status and puts it on the list', () => {
    const t = two();
    const id = addJustMe(t, 'Ran', { year: 1985 });
    expect(addManual(t, 'Ran', { year: 1985, status: 'watched', watchedOn: '2026-09-01' })).toBe(id);
    expect(t.db.list('watched').map((i) => i.id)).toEqual([id]);
    expect(t.db.list('later', 'me').map((i) => i.id)).toEqual([id]); // still on my own list too
  });
});

describe('personal lists (read models)', () => {
  it('Watch solo: my list shows it at my season, Together is unchanged', () => {
    const t = two();
    const id = addManual(t, 'Severance', { mediaKind: 'series' });
    t.db.dispatch({ kind: 'SetCurrentSeason', titleId: id, season: 1 }, t.env);
    t.tick();
    expect(t.db.dispatch({ kind: 'SetMyStatus', titleId: id, memberId: ANA, memberStatusId: mstatusIdOf(id, ANA), status: 'watching' }, t.env).ok).toBe(true);
    t.tick();
    expect(t.db.dispatch({ kind: 'SetMySeason', titleId: id, memberId: ANA, memberStatusId: mstatusIdOf(id, ANA), season: 2 }, t.env).ok).toBe(true);
    expect(t.db.list('watching', 'me')).toMatchObject([{ id, status: 'watching', currentSeason: 2 }]);
    expect(t.db.list('later')).toMatchObject([{ id, status: 'later', currentSeason: 1 }]);
    expect(t.db.list('watching')).toEqual([]);
  });
  it('Together title watched solo stays on Together as Watch later', () => {
    const t = two();
    const id = addManual(t, 'Heat');
    setMine(t, id, 'watched', '2026-09-20');
    expect(t.db.list('watched', 'me')).toMatchObject([{ id, status: 'watched', watchedOn: '2026-09-20' }]);
    expect(t.db.list('later').map((i) => i.id)).toEqual([id]);
    expect(t.db.list('watched')).toEqual([]);
  });
  it("the partner's list is read from their rows; each person sees theirs as 'me'", () => {
    const t = two();
    const id = addManual(t, 'Heat');
    setMine(t, id, 'later');
    as(t, BEN);
    setMine(t, id, 'watched');
    expect(t.db.list('watched', 'me').map((i) => i.id)).toEqual([id]);
    expect(t.db.list('watched', 'partner')).toEqual([]);
    expect(t.db.list('later', 'partner').map((i) => i.id)).toEqual([id]);
    as(t, ANA);
    expect(t.db.list('watched', 'partner').map((i) => i.id)).toEqual([id]);
  });
  it('a personal list orders by recency and carries stars', () => {
    const t = two();
    const a = addJustMe(t, 'Alpha');
    const b = addJustMe(t, 'Beta');
    expect(t.db.list('later', 'me').map((i) => i.id)).toEqual([b, a]);
    rate(t, a, 9);
    expect(t.db.list('later', 'me').find((i) => i.id === a)?.mine).toBe(9);
    expect(t.db.list('later', 'me').find((i) => i.id === b)?.mine).toBeNull();
  });
  it('a removed title leaves every list; taking it off my list clears it', () => {
    const t = two();
    const id = addJustMe(t, 'Ran');
    setMine(t, id, null);
    expect(t.db.list('later', 'me')).toEqual([]);
    setMine(t, id, 'later');
    t.db.dispatch({ kind: 'RemoveTitle', titleId: id }, t.env);
    expect(t.db.list('later', 'me')).toEqual([]);
  });
  it('no list without a member or a partner', () => {
    const t = openTestDb(1, null);
    expect(t.db.list('later', 'me')).toEqual([]);
    expect(t.db.list('later', 'partner')).toEqual([]);
  });
  it('title detail shows all three statuses, the partner as not on their list', () => {
    const t = two();
    const id = addManual(t, 'Heat');
    setMine(t, id, 'watched', '2026-09-20');
    const d = t.db.title(id)!;
    expect(d.title.status).toBe('later');
    expect(d.personal).toEqual([
      { memberId: ANA, name: 'Ana', mine: true, status: 'watched', watchedOn: '2026-09-20', currentSeason: null },
      { memberId: BEN, name: 'Ben', mine: false, status: null, watchedOn: null, currentSeason: null },
    ]);
    expect(d.recommendations).toEqual([]);
  });
});

describe('writes are single-writer', () => {
  it("refuses to write the partner's list or recommendations that are not yours", () => {
    const t = two();
    const id = addManual(t, 'Heat');
    expect(t.db.dispatch({ kind: 'SetMyStatus', titleId: id, memberId: BEN, memberStatusId: mstatusIdOf(id, BEN), status: 'later' }, t.env)).toEqual({ ok: false, error: { kind: 'NotYourList' } });
    expect(t.raw.selectValue('SELECT COUNT(*) FROM member_status')).toBe(0);
    recommend(t, id, ANA, BEN);
    const rid = recIdOf(id, ANA, BEN);
    as(t, BEN);
    expect(t.db.dispatch({ kind: 'WithdrawRecommendation', id: rid }, t.env)).toEqual({ ok: false, error: { kind: 'NotYours' } });
    as(t, ANA);
    expect(answer(t, rid, id, ANA, 'accepted')).toEqual({ ok: false, error: { kind: 'NotYours' } });
  });
});

describe('recommendations', () => {
  it('Recommend, Accept: it moves from the partner\'s pending list to their Watch later', () => {
    const t = two();
    const id = addJustMe(t, 'Ran', { year: 1985, status: 'watched', watchedOn: '2026-09-01' });
    recommend(t, id, ANA, BEN);
    as(t, BEN);
    expect(t.db.pendingRecommendations()).toMatchObject([{ id: recIdOf(id, ANA, BEN), titleId: id, fromName: 'Ana', title: 'Ran', state: 'open' }]);
    as(t, ANA);
    expect(t.db.pendingRecommendations()).toEqual([]);
    expect(answer(t, recIdOf(id, ANA, BEN), id, BEN, 'accepted').ok).toBe(true);
    expect(t.db.pendingRecommendations()).toEqual([]);
    expect(t.db.list('later', 'me').map((i) => i.id)).toEqual([id]);
    as(t, ANA);
    expect(t.db.list('later', 'partner').map((i) => i.id)).toEqual([id]);
    expect(t.db.title(id)!.recommendations).toMatchObject([{ state: 'accepted', fromMe: true }]);
  });
  it('Dismiss: gone for the partner, and the recommender sees it was dismissed', () => {
    const t = two();
    const id = addJustMe(t, 'Ran');
    recommend(t, id, ANA, BEN);
    expect(answer(t, recIdOf(id, ANA, BEN), id, BEN, 'dismissed').ok).toBe(true);
    expect(t.db.pendingRecommendations()).toEqual([]);
    expect(t.db.list('later', 'me')).toEqual([]);
    as(t, ANA);
    expect(t.db.title(id)!.recommendations).toMatchObject([{ state: 'dismissed', fromMe: true, toName: 'Ben' }]);
  });
  it('Withdraw: gone from the partner\'s pending list; the recommender can send it again', () => {
    const t = two();
    const id = addJustMe(t, 'Ran');
    recommend(t, id, ANA, BEN);
    t.tick();
    expect(t.db.dispatch({ kind: 'WithdrawRecommendation', id: recIdOf(id, ANA, BEN) }, t.env).ok).toBe(true);
    as(t, BEN);
    expect(t.db.pendingRecommendations()).toEqual([]);
    as(t, ANA);
    expect(t.db.title(id)!.recommendations[0]!.state).toBe('withdrawn');
    recommend(t, id, ANA, BEN);
    as(t, BEN);
    expect(t.db.pendingRecommendations()).toHaveLength(1);
  });
  it('a recommendation stops being pending once the partner gives the title a personal status themselves', () => {
    const t = two();
    const id = addManual(t, 'Heat');
    recommend(t, id, ANA, BEN);
    as(t, BEN);
    setMine(t, id, 'later');
    expect(t.db.pendingRecommendations()).toEqual([]);
  });
});

describe('export and import carry personal data (D6)', () => {
  function populated(): TestDb {
    const t = two();
    const heat = addManual(t, 'Heat');
    const ran = addJustMe(t, 'Ran', { year: 1985, status: 'watched', watchedOn: '2026-09-01' });
    setMine(t, heat, 'later');
    as(t, BEN);
    setMine(t, heat, 'watched', '2026-09-22');
    recommend(t, ran, ANA, BEN);
    answer(t, recIdOf(ran, ANA, BEN), ran, BEN, 'dismissed');
    recommend(t, heat, BEN, ANA);
    return t;
  }
  const NOW = '2026-09-30T12:00:00.000Z' as never;

  it('Round trip: both members\' lists and all recommendations are identical in an empty database', () => {
    const t = populated();
    const text = exportText(t.raw, NOW);
    const parsed = JSON.parse(text) as { memberStatus: unknown[]; recommendations: unknown[]; titles: { status: string | null }[] };
    expect(parsed.memberStatus).toHaveLength(3);
    expect(parsed.recommendations).toHaveLength(2);
    expect(parsed.titles.some((x) => x.status === null)).toBe(true);

    const fresh = openTestDb(2, ANA);
    const r = importText(fresh.raw, text, fresh.db.ensureDeviceId(uuid(0xd002)), fresh.env.wallMs, fresh.env.newOpId);
    expect(r.ok).toBe(true);
    expect(exportText(fresh.raw, NOW)).toBe(text);
    const rows = (x: TestDb, sql: string) => JSON.stringify(x.raw.selectArrays(sql));
    for (const sql of ['SELECT * FROM member_status ORDER BY id', 'SELECT * FROM recommendations ORDER BY id', 'SELECT * FROM titles ORDER BY id']) {
      expect(rows(fresh, sql)).toBe(rows(t, sql));
    }
    // And the imported rows are local writes, so they would sync (tier p).
    expect(fresh.raw.selectValue("SELECT COUNT(*) FROM change_log WHERE tbl IN ('member_status', 'recommendations')")).toBe(5);
  });
  it('importing the same file twice adds nothing', () => {
    const t = populated();
    const text = exportText(t.raw, NOW);
    const fresh = openTestDb(2, ANA);
    const dev = fresh.db.ensureDeviceId(uuid(0xd002));
    importText(fresh.raw, text, dev, fresh.env.wallMs, fresh.env.newOpId);
    const again = importText(fresh.raw, text, dev, fresh.env.wallMs, fresh.env.newOpId);
    expect(again).toMatchObject({ ok: true, value: { added: 0 } });
  });
  it('an export written before personal lists still imports', () => {
    const t = two();
    addManual(t, 'Heat');
    const o = JSON.parse(exportText(t.raw, NOW)) as Record<string, unknown>;
    delete o['memberStatus'];
    delete o['recommendations'];
    const fresh = openTestDb(2, ANA);
    const r = importText(fresh.raw, JSON.stringify(o), fresh.db.ensureDeviceId(uuid(0xd002)), fresh.env.wallMs, fresh.env.newOpId);
    expect(r).toMatchObject({ ok: true });
    expect(fresh.raw.selectValue('SELECT COUNT(*) FROM titles')).toBe(1);
  });
});

describe('sync schema of the new rows', () => {
  it('local writes to the new tables are logged as tier p, a Together add as base', () => {
    const t = two();
    addManual(t, 'Heat');
    const id = addJustMe(t, 'Ran');
    const tier = (tbl: string, rowId: string) => {
      const rows = t.raw.selectObjects('SELECT fields_json FROM change_log WHERE tbl = ? AND row_id = ?', [tbl, rowId]);
      return rows.map((r) => cinefiloSchema.tierOf(tbl as never, JSON.parse(r['fields_json'] as string) as never));
    };
    expect(tier('titles', id)).toEqual(['p']);
    expect(tier('member_status', mstatusIdOf(id, ANA))).toEqual(['p']);
    expect(tier('titles', hashId('cinefilo-title-v1|manual|movie|heat|'))).toEqual(['base']);
  });
});

describe('dump covers the new tables', () => {
  it('the logical dump changes when a personal status does', () => {
    const t = two();
    const id = addManual(t, 'Heat');
    const before = dump(t.raw);
    setMine(t, id, 'later');
    expect(dump(t.raw)).not.toBe(before);
  });
});
