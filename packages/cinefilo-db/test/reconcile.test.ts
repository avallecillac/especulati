// 4.2 at DB level: reconcile after a sync and after AddTitle / LinkToTmdb.
import { describe, expect, it } from 'vitest';
import { reconcileAll } from '../src/index.ts';
import { addManual, ANA, BEN, dump, hashId, hashIdAsync, rate, seedMembers, openTestDb } from './helpers.ts';
import { fakeRelay, makePeer, untilQuiet } from './harness.ts';

const tmdbId = (kind: 'movie' | 'series', n: number) => hashId(`cinefilo-title-v1|tmdb|${kind}|${n}`);

describe('reconcile (4.2)', () => {
  it('one adds by hand and links, the other adds from TMDB: after sync and reconcile there is one live title with both ratings', async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay, ANA);
    const b = makePeer(2, relay, BEN);
    seedMembers(a, ANA);
    expect((await a.engine.turnOn()).ok).toBe(true);
    expect((await b.engine.join(a.engine.showCode()!.code)).ok).toBe(true);
    await untilQuiet([a, b]);

    // A: by hand, then linked to TMDB 603. B (offline): the same film from TMDB.
    const manual = addManual(a, 'The Matrix', { year: 1999 });
    a.tick();
    expect(a.db.dispatch({ kind: 'LinkToTmdb', titleId: manual, tmdbId: 603, details: { runtimeMin: 136 } }, a.env).ok).toBe(true);
    rate(a, manual, 'like', 'whoa');
    const tmdb = tmdbId('movie', 603);
    b.tick();
    expect(b.db.dispatch({ kind: 'AddTitle', titleId: tmdb, mediaKind: 'movie', title: 'The Matrix', tmdbId: 603, year: 1999, addedBy: BEN }, b.env).ok).toBe(true);
    rate(b, tmdb, 'dislike', 'meh actually');

    await untilQuiet([a, b]);
    for (const p of [a, b]) {
      const live = p.db.list('later');
      expect(live.map((i) => i.id)).toEqual([tmdb]); // the TMDB-derived id survives
      const d = p.db.title(tmdb)!;
      expect(d.ratings.map((r) => [r.name, r.verdict, r.review])).toEqual(
        p === a
          ? [['Ana', 'like', 'whoa'], ['Ben', 'dislike', 'meh actually']]
          : [['Ben', 'dislike', 'meh actually'], ['Ana', 'like', 'whoa']],
      );
      expect(p.raw.selectValue('SELECT merged_into FROM titles WHERE id = ?', [manual])).toBe(tmdb);
      expect(p.db.title(manual)).toBeNull();
      expect(d.title.runtimeMin).toBe(136); // the manual row's linked details carried over
    }
    expect(dump(a.raw)).toBe(dump(b.raw));
    a.close();
    b.close();
  });

  it('is idempotent, and a late edit to the merged-away row is carried over on the next pass', async () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const manual = addManual(t, 'Heat', { year: 1995 });
    t.tick();
    t.db.dispatch({ kind: 'LinkToTmdb', titleId: manual, tmdbId: 949, details: {} }, t.env);
    const tmdb = tmdbId('movie', 949);
    t.tick();
    t.db.dispatch({ kind: 'AddTitle', titleId: tmdb, mediaKind: 'movie', title: 'Heat', tmdbId: 949, addedBy: ANA }, t.env);
    t.tick();
    expect(await reconcileAll(t.db, () => t.env, hashIdAsync)).toBeGreaterThan(0);
    t.tick();
    expect(await reconcileAll(t.db, () => t.env, hashIdAsync)).toBe(0);

    // A device that had not seen the merge edits the loser later; the next pass moves it to the survivor.
    t.tick(60_000);
    expect(t.db.dispatch({ kind: 'SetStatus', titleId: manual, status: 'watched', watchedOn: '2026-05-05' }, t.env).ok).toBe(false); // merged rows reject edits
    t.raw.exec(`UPDATE titles SET status = 'watched', watched_on = '2026-05-05' WHERE id = '${manual}'`);
    t.tick(60_000);
    t.raw.exec(`UPDATE field_clock SET hlc = '9999999999999-0000-${t.env.newOpId()}' WHERE row_id = '${manual}' AND field IN ('status','watched_on')`);
    expect(await reconcileAll(t.db, () => t.env, hashIdAsync)).toBe(1);
    expect(t.db.list('watched').map((i) => i.id)).toEqual([tmdb]);
  });

  it('a local AddTitle of a film already linked from the other side reconciles at once', async () => {
    const t = openTestDb(1, ANA);
    seedMembers(t, ANA);
    const manual = addManual(t, 'Alien', { year: 1979 });
    t.tick();
    t.db.dispatch({ kind: 'LinkToTmdb', titleId: manual, tmdbId: 348, details: {} }, t.env);
    t.tick();
    t.db.dispatch({ kind: 'AddTitle', titleId: tmdbId('movie', 348), mediaKind: 'movie', title: 'Alien', tmdbId: 348, addedBy: ANA }, t.env);
    await reconcileAll(t.db, () => t.env, hashIdAsync);
    expect(t.db.list('later')).toHaveLength(1);
  });
});
