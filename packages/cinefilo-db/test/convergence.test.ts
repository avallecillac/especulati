// 3.4: convergence of Cinéfilo's catalog. 2 members on 3 devices (Ana on two, Ben on one), random command
// streams over a small pool of titles so the same film is added offline on several devices, with concurrent
// status, season and rating edits, remove versus rate, and link plus reconcile; delivery in random order with
// duplicates, partly through the relay and partly directly. Every database must end identical.
import { describe, expect, it } from 'vitest';
import { applyRemoteOps } from '@especulati/db-kit';
import { cinefiloSchema, manualTitleLabel, parseRemoteOp, ratingLabel, tmdbTitleLabel, type Kind, type OpWire } from '@especulati/cinefilo-core';
import { ANA, BEN, dump, hashId } from './helpers.ts';
import { fakeRelay, makePeer, prng, untilQuiet, type Peer } from './harness.ts';
import { cinefiloCanInsert } from '../src/index.ts';

// `pnpm test:convergence` runs 1,000 (SC-003); the everyday `pnpm test` runs 200.
const RUNS = Number(process.env['CONVERGENCE_RUNS'] ?? 200);
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

const NAMES = ['Solaris', 'Amélie', 'Heat', 'Alien', 'Dune', 'Ran'] as const;
const YEARS = [null, 1972, 2001] as const;
const TMDB = [11, 12, 13] as const;
const DATES = ['2026-01-05', '2026-02-10', '2026-03-15'] as const;
const STATUSES = ['later', 'watching', 'watched', 'dropped'] as const;

const liveTitles = (p: Peer): { id: string; kind: Kind; tmdb: number | null }[] =>
  p.raw.selectObjects('SELECT id, kind, tmdb_id FROM titles WHERE deleted_at IS NULL AND merged_into IS NULL ORDER BY id').map((r) => ({ id: r['id'] as string, kind: r['kind'] as Kind, tmdb: r['tmdb_id'] as number | null }));
const anyTitles = (p: Peer): { id: string }[] => p.raw.selectObjects('SELECT id FROM titles ORDER BY id').map((r) => ({ id: r['id'] as string }));

/** One random local write on a peer. Rejections are fine: they change nothing. */
async function localWrite(rng: () => number, p: Peer, member: string): Promise<void> {
  p.tick(int(rng, 1, 5000));
  const live = liveTitles(p);
  const k = rng();
  const dispatch = (cmd: Parameters<Peer['db']['dispatch']>[0]) => p.db.dispatch(cmd, p.env);
  if (live.length === 0 || k < 0.2) {
    const kind: Kind = rng() < 0.7 ? 'movie' : 'series';
    const status = pick(rng, ['later', 'later', 'watched'] as const);
    const watchedOn = status === 'watched' ? { watchedOn: pick(rng, DATES) } : {};
    if (rng() < 0.4) {
      const tmdbId = pick(rng, TMDB);
      dispatch({ kind: 'AddTitle', titleId: hashId(tmdbTitleLabel(kind, tmdbId)), mediaKind: kind, title: `TMDB ${tmdbId}`, tmdbId, status, ...watchedOn, addedBy: member });
    } else {
      const title = pick(rng, NAMES);
      const year = pick(rng, YEARS);
      dispatch({ kind: 'AddTitle', titleId: hashId(manualTitleLabel(kind, title, year)), mediaKind: kind, title, ...(year ? { year } : {}), status, ...watchedOn, addedBy: member });
    }
    await p.reconcile();
  } else if (k < 0.3) {
    const t = pick(rng, live.filter((x) => x.tmdb === null));
    if (t) {
      dispatch({ kind: 'LinkToTmdb', titleId: t.id, tmdbId: pick(rng, TMDB), details: { runtimeMin: int(rng, 80, 180) } });
      await p.reconcile();
    }
  } else if (k < 0.45) {
    dispatch({ kind: 'SetStatus', titleId: pick(rng, live).id, status: pick(rng, STATUSES), watchedOn: pick(rng, DATES) });
  } else if (k < 0.52) {
    dispatch({ kind: 'SetCurrentSeason', titleId: pick(rng, live).id, season: int(rng, 1, 4) });
  } else if (k < 0.68) {
    const titleId = pick(rng, live).id;
    dispatch({ kind: 'SetVerdict', titleId, memberId: member, ratingId: hashId(ratingLabel(titleId, member)), verdict: pick(rng, ['like', 'meh', 'dislike', null] as const) });
  } else if (k < 0.78) {
    const titleId = pick(rng, live).id;
    dispatch({ kind: 'SetReview', titleId, memberId: member, ratingId: hashId(ratingLabel(titleId, member)), review: rng() < 0.2 ? '' : `Review ${int(rng, 0, 99)}` });
  } else if (k < 0.88) {
    dispatch({ kind: 'RemoveTitle', titleId: pick(rng, live).id });
  } else if (k < 0.94) {
    dispatch({ kind: 'RestoreTitle', titleId: pick(rng, anyTitles(p)).id });
  } else if (k < 0.97) {
    dispatch({ kind: 'EditTitleDetails', titleId: pick(rng, live).id, title: `${pick(rng, NAMES)} ${int(rng, 0, 9)}`, year: int(rng, 1900, 2020) });
  } else {
    dispatch({ kind: 'RenameMember', memberId: member, name: `${member === ANA ? 'Ana' : 'Ben'} ${int(rng, 0, 99)}` });
  }
}

/** Feed `to` a shuffled, partly duplicated subset of `from`'s ops, bypassing the relay. */
function directDelivery(rng: () => number, from: Peer, to: Peer): void {
  const rows = from.raw.selectObjects('SELECT op_id, hlc, tbl, row_id, fields_json FROM change_log ORDER BY seq');
  const chosen: (typeof rows)[number][] = [];
  for (const r of rows) {
    if (rng() < 0.5) chosen.push(r);
    if (rng() < 0.2) chosen.push(r);
  }
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j]!, chosen[i]!];
  }
  const deviceOf = (p: Peer) => p.db.ensureDeviceId('unused');
  const ops = chosen.map((r) => {
    const w: OpWire = { op: r.op_id as string, hlc: r.hlc as string, tbl: r.tbl as string, row: r.row_id as string, fields: JSON.parse(r.fields_json as string) as OpWire['fields'] };
    const parsed = parseRemoteOp(w, deviceOf(from));
    if (!parsed.ok) throw new Error('bad op in change_log');
    return parsed.value;
  });
  applyRemoteOps(to.raw, cinefiloSchema, cinefiloCanInsert, ops, deviceOf(to), () => to.env.wallMs());
}

const stats = { ops: 0, titles: 0, merged: 0, removed: 0, ratings: 0 };

async function oneRun(seed: number): Promise<void> {
  const rng = prng(seed);
  const relay = fakeRelay();
  const members = [ANA, ANA, BEN];
  const peers = members.map((m, i) => makePeer(i + 1, relay, m, prng(seed * 31 + i), T0 + int(rng, -3_600_000, 3_600_000)));
  try {
    // Setup: Ana's first device creates both members and the space; the others join.
    const [first] = peers as [Peer, ...Peer[]];
    for (const [id, name] of [[ANA, 'Ana'], [BEN, 'Ben']] as const) {
      first.tick();
      expect(first.db.dispatch({ kind: 'CreateMember', memberId: id, name }, first.env).ok).toBe(true);
    }
    expect((await first.engine.turnOn()).ok).toBe(true);
    const code = first.engine.showCode()!.code;
    for (const p of peers.slice(1)) expect((await p.engine.join(code)).ok).toBe(true);
    await untilQuiet(peers);

    const steps = int(rng, 25, 70);
    for (let s = 0; s < steps; s++) {
      const i = Math.floor(rng() * peers.length);
      const p = peers[i]!;
      const a = rng();
      if (a < 0.5) await localWrite(rng, p, members[i]!);
      else if (a < 0.72) {
        p.tick(int(rng, 1, 3000));
        const r = await p.engine.run('manual');
        if (r.problem && r.problem !== 'offline') throw new Error(`run problem: ${r.problem}`);
        if (r.changed) await p.reconcile(); // as the worker does after a sync
      } else if (a < 0.84) {
        directDelivery(rng, pick(rng, peers.filter((q) => q !== p)), p);
      } else if (a < 0.92) {
        p.online = !p.online; // a device that goes offline keeps editing and catches up later
      } else {
        await p.reconcile();
      }
    }
    for (const p of peers) p.online = true;
    await untilQuiet(peers);

    const first1 = dump(peers[0]!.raw);
    for (const p of peers.slice(1)) {
      if (dump(p.raw) !== first1) throw new Error(`peer ${p.n} differs from peer 1 (${steps} steps)`);
    }
    for (const p of peers) {
      if (p.raw.selectValue('SELECT COUNT(*) FROM sync_inbox') !== 0) throw new Error(`peer ${p.n} has a stuck inbox`);
      // Reconcile is at rest: a further pass changes nothing.
      if ((await p.reconcile()) !== 0) throw new Error(`peer ${p.n} still has titles to reconcile`);
    }
    const raw = peers[0]!.raw;
    stats.ops += Number(raw.selectValue('SELECT COUNT(*) FROM change_log'));
    stats.titles += Number(raw.selectValue('SELECT COUNT(*) FROM titles'));
    stats.merged += Number(raw.selectValue('SELECT COUNT(*) FROM titles WHERE merged_into IS NOT NULL'));
    stats.removed += Number(raw.selectValue('SELECT COUNT(*) FROM titles WHERE deleted_at IS NOT NULL'));
    stats.ratings += Number(raw.selectValue('SELECT COUNT(*) FROM ratings'));
  } finally {
    for (const p of peers) p.close();
  }
}

describe('convergence (3.4)', () => {
  it(`${RUNS} seeded runs of 3 devices (2 members) end with identical data`, { timeout: 1_800_000 }, async () => {
    const t0 = performance.now();
    for (let seed = 1; seed <= RUNS; seed++) {
      try {
        await oneRun(seed);
      } catch (e) {
        console.error(`CONVERGENCE FAILED, seed=${seed}`);
        throw new Error(`seed=${seed}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
    // Make sure the generator really exercises merges, removals and ratings.
    expect(stats.merged).toBeGreaterThan(0);
    expect(stats.removed).toBeGreaterThan(0);
    expect(stats.ratings).toBeGreaterThan(0);
    console.log(`cinefilo convergence: ${RUNS} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s (${JSON.stringify(stats)} total ops/titles/merged/removed/ratings)`);
  });
});
