// 3.4: convergence of Cinéfilo's catalog. 2 members on 3 devices (Ana on two, Ben on one), random command
// streams over a small pool of titles so the same film is added offline on several devices, with concurrent
// status, season and rating edits, remove versus rate, and link plus reconcile; since personal lists also "Just me"
// adds, personal statuses and seasons, and recommendations with withdrawals and answers; delivery in random order with
// duplicates, partly through the relay and partly directly. Every database must end identical. A second suite adds a
// peer on the previous version (it skips tier-`p` batches), then upgrades it (D4).
import { describe, expect, it } from 'vitest';
import { applyRemoteOps } from '@especulati/db-kit';
import { cinefiloSchema, manualTitleLabel, memberStatusLabel, parseRemoteOp, ratingLabel, recommendationLabel, tmdbTitleLabel, type Kind, type OpWire } from '@especulati/cinefilo-core';
import { createRelayClient, deriveKeys, open, parseSyncCode } from '@especulati/sync';
import { ANA, BEN, dump, hashId } from './helpers.ts';
import { fakeRelay, makePeer, prng, untilQuiet, type Peer } from './harness.ts';
import { cinefiloCanInsert, cinefiloSyncApp } from '../src/index.ts';

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

/** One random personal-list write (personal-lists D2/D3): rejections are fine, they change nothing. */
async function personalWrite(rng: () => number, p: Peer, member: string): Promise<void> {
  const live = liveTitles(p);
  const other = member === ANA ? BEN : ANA;
  const dispatch = (cmd: Parameters<Peer['db']['dispatch']>[0]) => p.db.dispatch(cmd, p.env);
  const k = rng();
  if (live.length === 0 || k < 0.25) {
    const kind: Kind = rng() < 0.6 ? 'movie' : 'series';
    const status = pick(rng, ['later', 'later', 'watching', 'watched'] as const);
    const watchedOn = status === 'watched' && rng() < 0.7 ? { watchedOn: pick(rng, DATES) } : {};
    const tmdbId = rng() < 0.4 ? pick(rng, TMDB) : null;
    const title = pick(rng, NAMES);
    const year = pick(rng, YEARS);
    const titleId = hashId(tmdbId !== null ? tmdbTitleLabel(kind, tmdbId) : manualTitleLabel(kind, title, year));
    dispatch({
      kind: 'AddTitle', titleId, mediaKind: kind, title: tmdbId !== null ? `TMDB ${tmdbId}` : title, ...(tmdbId !== null ? { tmdbId } : year ? { year } : {}),
      to: rng() < 0.85 ? 'me' : 'together', memberStatusId: hashId(memberStatusLabel(titleId, member)), status, ...watchedOn, addedBy: member,
    });
    await p.reconcile();
  } else if (k < 0.5) {
    const titleId = pick(rng, live).id;
    const status = pick(rng, ['later', 'watching', 'watched', null] as const);
    dispatch({ kind: 'SetMyStatus', titleId, memberId: member, memberStatusId: hashId(memberStatusLabel(titleId, member)), status, ...(status === 'watched' && rng() < 0.7 ? { watchedOn: pick(rng, DATES) } : {}) });
  } else if (k < 0.6) {
    const titleId = pick(rng, live).id;
    dispatch({ kind: 'SetMySeason', titleId, memberId: member, memberStatusId: hashId(memberStatusLabel(titleId, member)), season: int(rng, 1, 4) });
  } else if (k < 0.78) {
    const titleId = pick(rng, live).id;
    dispatch({ kind: 'Recommend', titleId, fromMember: member, toMember: other, recommendationId: hashId(recommendationLabel(titleId, member, other)) });
  } else {
    const recs = p.raw.selectObjects('SELECT id, title_id, from_member, to_member FROM recommendations WHERE deleted_at IS NULL ORDER BY id');
    if (recs.length === 0) return;
    const r = pick(rng, recs);
    const titleId = r['title_id'] as string;
    if (k < 0.86) dispatch({ kind: 'WithdrawRecommendation', id: r['id'] as string });
    else if (k < 0.97) {
      dispatch({ kind: 'AnswerRecommendation', id: r['id'] as string, titleId, memberId: member, memberStatusId: hashId(memberStatusLabel(titleId, member)), answer: rng() < 0.6 ? 'accepted' : 'dismissed' });
    } else {
      // The wrong person acts: always rejected, nothing is written.
      dispatch({ kind: 'AnswerRecommendation', id: r['id'] as string, titleId, memberId: other, memberStatusId: hashId(memberStatusLabel(titleId, other)), answer: 'accepted' });
    }
  }
}

/** One random local write on a peer. Rejections are fine: they change nothing. `personal` off = what a previous-version device can do. */
async function localWrite(rng: () => number, p: Peer, member: string, personal = true): Promise<void> {
  p.tick(int(rng, 1, 5000));
  if (personal && rng() < 0.3) return personalWrite(rng, p, member);
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
  } else if (k < 0.37) {
    // cinefilo-feedback-1 D2/D3: concurrent "mark watched on Together" (numbered max + 1 on each device) and leaving Watched.
    dispatch({ kind: 'SetStatus', titleId: pick(rng, live).id, status: rng() < 0.75 ? 'watched' : 'later', ...(rng() < 0.7 ? { watchedOn: pick(rng, DATES) } : {}) });
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

const stats = { ops: 0, titles: 0, merged: 0, removed: 0, ratings: 0, personal: 0, recs: 0, answered: 0, offTogether: 0, numbered: 0 };

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
    // The computed history numbers are the same on every device, and distinct (D1).
    const numbers = (p: Peer) => JSON.stringify(p.db.list('watched').map((i) => [i.id, i.watchOrder]));
    for (const p of peers.slice(1)) if (numbers(p) !== numbers(peers[0]!)) throw new Error(`peer ${p.n} numbers the history differently`);
    const shown = peers[0]!.db.list('watched').flatMap((i) => (i.watchOrder === null ? [] : [i.watchOrder]));
    if (new Set(shown).size !== shown.length || shown.some((n, i) => n !== shown.length - i)) throw new Error('the history numbers are not 1..N newest first');
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
    stats.personal += Number(raw.selectValue('SELECT COUNT(*) FROM member_status'));
    stats.recs += Number(raw.selectValue('SELECT COUNT(*) FROM recommendations'));
    stats.answered += Number(raw.selectValue('SELECT COUNT(*) FROM recommendations WHERE answered IS NOT NULL'));
    stats.numbered += Number(raw.selectValue('SELECT COUNT(*) FROM titles WHERE watch_order IS NOT NULL'));
    stats.offTogether += Number(raw.selectValue('SELECT COUNT(*) FROM titles WHERE status IS NULL'));
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
    expect(stats.personal).toBeGreaterThan(0);
    expect(stats.recs).toBeGreaterThan(0);
    expect(stats.answered).toBeGreaterThan(0);
    expect(stats.offTogether).toBeGreaterThan(0);
    expect(stats.numbered).toBeGreaterThan(0);
    console.log(`cinefilo convergence: ${RUNS} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s (${JSON.stringify(stats)} total ops/titles/merged/removed/ratings/personal/recs/answered/offTogether)`);
  });
});

// Personal-lists D4. A device on the previous version refuses any batch with a `member_status` or `recommendations` op
// or a `titles` op that writes `status: null` (its schema has no such table, and its titles.status is NOT NULL), skips it
// whole and moves its cursor on. Those ops go out in their own tier-`p` batches, so the skipped batch never holds a base
// op; after the upgrade (migration 2 resets the cursor) it re-reads the space and converges.
describe('forward compatibility: a previous-version peer (D4)', () => {
  const OLD_RUNS = RUNS;
  const OLD_TABLES = new Set(['titles', 'members', 'ratings']);
  const logicalDump = (p: Peer): string => dump(p.raw);
  /** Rows of the old tables that peer `v` holds, as `[table, row]` strings, for comparing against a full peer. */
  const rowsOf = (p: Peer, tbl: string, ids: string[]): string =>
    JSON.stringify(ids.map((id) => p.raw.selectArrays(`SELECT * FROM ${tbl} WHERE id = ?`, [id])));

  /** What the previous version does on a pull: a batch with an op it cannot parse is skipped whole, and counted. */
  async function oldPull(p: Peer, code: string, relay: ReturnType<typeof fakeRelay>): Promise<number> {
    const k = parseSyncCode(code);
    if (!k.ok) throw new Error('code');
    const keys = await deriveKeys(k.value, cinefiloSyncApp.salt);
    const client = createRelayClient(relay.fetch, keys.spaceId, keys.authToken, () => true);
    const store = p.db.syncStore;
    let applied = 0;
    for (let more = true; more; ) {
      const cursor = store.syncMeta().cursor;
      const page = await client.getBatches(cursor, 100);
      if (!page.ok) throw new Error(`pull ${page.kind}`);
      const ops: NonNullable<ReturnType<typeof parseRemoteOp> extends infer R ? (R extends { ok: true; value: infer V } ? V : never) : never>[] = [];
      let skipped = 0;
      let last = cursor;
      for (const b of page.value.batches) {
        last = b.seq;
        const opened = await open(b, keys.encKey, keys.spaceId, cinefiloSyncApp.aadPrefix);
        if (!opened.ok) { skipped++; continue; }
        const unreadable = opened.value.ops.some((w) => !OLD_TABLES.has(w.tbl) || (w.tbl === 'titles' && (('status' in w.fields && w.fields['status'] === null) || 'watch_order' in w.fields)));
        if (unreadable) { skipped++; continue; }
        for (const w of opened.value.ops) {
          const r = parseRemoteOp(w, opened.value.device);
          if (!r.ok) throw new Error('the previous version could not parse a base op');
          ops.push(r.value);
        }
      }
      if (last !== cursor) applied += store.applyPulledPage(ops, last, () => p.env.wallMs()).applied;
      if (skipped > 0) {
        const st = store.syncMeta().status;
        store.setSyncMeta({ status: { lastOkAt: st?.lastOkAt ?? null, problem: st?.problem ?? null, undecryptable: (st?.undecryptable ?? 0) + skipped } });
      }
      more = page.value.more;
    }
    return applied;
  }

  async function quiet(full: Peer[], old: Peer | null, code: string, relay: ReturnType<typeof fakeRelay>): Promise<void> {
    let calm = 0;
    for (let round = 0; round < 16 && calm < 2; round++) {
      let moved = 0;
      for (const p of full) {
        p.tick(1000);
        const r = await p.engine.run('manual');
        if (r.problem) throw new Error(`run problem: ${r.problem}`);
        moved += r.pulled + r.pushed;
        moved += await p.reconcile();
      }
      if (old) {
        old.tick(1000);
        moved += await oldPull(old, code, relay);
        moved += await old.reconcile();
        const r = await old.engine.run('write', { pushOnly: true });
        if (r.problem) throw new Error(`run problem: ${r.problem}`);
        moved += r.pushed;
      }
      calm = moved === 0 ? calm + 1 : 0;
    }
    if (calm < 2) throw new Error('did not go quiet in 16 rounds');
  }

  const totals = { personalOps: 0, skippedBatches: 0, oldWrites: 0 };

  async function oneOldRun(seed: number): Promise<void> {
    const rng = prng(seed + 7_000_000);
    const relay = fakeRelay();
    const members = [ANA, BEN, ANA];
    const peers = members.map((m, i) => makePeer(i + 1, relay, m, prng(seed * 37 + i), T0 + int(rng, -3_600_000, 3_600_000)));
    const [a, b, v] = [peers[0]!, peers[1]!, peers[2]!];
    try {
      for (const [id, name] of [[ANA, 'Ana'], [BEN, 'Ben']] as const) {
        a.tick();
        expect(a.db.dispatch({ kind: 'CreateMember', memberId: id, name }, a.env).ok).toBe(true);
      }
      expect((await a.engine.turnOn()).ok).toBe(true);
      const code = a.engine.showCode()!.code;
      expect((await b.engine.join(code)).ok).toBe(true);
      expect((await v.engine.join(code)).ok).toBe(true);
      await untilQuiet([a, b, v]);

      for (let s = 0, steps = int(rng, 25, 60); s < steps; s++) {
        const i = Math.floor(rng() * peers.length);
        const p = peers[i]!;
        const act = rng();
        if (act < 0.6) {
          if (p === v) totals.oldWrites++;
          await localWrite(rng, p, members[i]!, p !== v);
        } else {
          p.tick(int(rng, 1, 3000));
          if (p === v) {
            await oldPull(v, code, relay);
            await v.engine.run('write', { pushOnly: true });
          } else {
            const r = await p.engine.run('manual');
            if (r.problem) throw new Error(`run problem: ${r.problem}`);
            if (r.changed) await p.reconcile();
          }
        }
      }

      // Phase 1: the old peer keeps skipping tier-p batches but still gets every base op on the rows it holds.
      await quiet([a, b], v, code, relay);
      // A title row touched by a tier-p op (it was added "Just me", or revived without a Together status) is allowed to lag
      // on the old peer, by design: the op carrying `status: null` is unreadable to it. Every other row must be identical.
      const lagging = new Set(
        a.raw
          .selectObjects("SELECT row_id, fields_json FROM change_log WHERE tbl = 'titles'")
          .filter((r) => {
            const f = JSON.parse(r['fields_json'] as string) as Record<string, unknown>;
            return f['status'] === null || 'watch_order' in f;
          })
          .map((r) => r['row_id'] as string),
      );
      const tables = ['titles', 'members', 'ratings'] as const;
      for (const tbl of tables) {
        const ids = v.raw.selectValues(`SELECT id FROM ${tbl} ORDER BY id`).map(String).filter((id) => !(tbl === 'titles' && lagging.has(id)));
        if (rowsOf(v, tbl, ids) !== rowsOf(a, tbl, ids)) throw new Error(`old peer disagrees with a full peer on ${tbl} while personal ops are in flight`);
      }
      if (v.raw.selectValue('SELECT COUNT(*) FROM member_status') !== 0 || v.raw.selectValue('SELECT COUNT(*) FROM recommendations') !== 0) throw new Error('old peer applied a personal row');
      if (v.raw.selectValue('SELECT COUNT(*) FROM titles WHERE status IS NULL') !== 0) throw new Error('old peer applied a title without a Together status');
      const personalOps = Number(a.raw.selectValue("SELECT COUNT(*) FROM change_log WHERE tbl IN ('member_status', 'recommendations') OR (tbl = 'titles' AND fields_json LIKE '%\"status\":null%')"));
      totals.personalOps += personalOps;
      const skipped = v.db.syncStore.syncMeta().status?.undecryptable ?? 0;
      totals.skippedBatches += skipped;
      if (personalOps > 0 && skipped === 0) throw new Error('the old peer should have skipped the personal batches');

      // Phase 2: the upgrade. Migration 2 resets the cursor and the counter; the real engine re-reads everything.
      v.db.syncStore.setSyncMeta({ cursor: 0, status: { lastOkAt: null, problem: null, undecryptable: 0 } });
      await quiet(peers, null, code, relay);
      const first = logicalDump(a);
      for (const p of [b, v]) if (logicalDump(p) !== first) throw new Error(`peer ${p.n} differs after the upgrade`);
      for (const p of peers) {
        if (p.raw.selectValue('SELECT COUNT(*) FROM sync_inbox') !== 0) throw new Error(`peer ${p.n} has a stuck inbox`);
        if ((await p.reconcile()) !== 0) throw new Error(`peer ${p.n} still has titles to reconcile`);
      }
    } finally {
      for (const p of peers) p.close();
    }
  }

  it(`${OLD_RUNS} seeded runs: the previous-version peer loses no base op, and converges after upgrading`, { timeout: 1_800_000 }, async () => {
    const t0 = performance.now();
    for (let seed = 1; seed <= OLD_RUNS; seed++) {
      try {
        await oneOldRun(seed);
      } catch (e) {
        console.error(`OLD-PEER CONVERGENCE FAILED, seed=${seed}`);
        throw new Error(`seed=${seed}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
    console.log(`previous-version peer: ${OLD_RUNS} runs in ${((performance.now() - t0) / 1000).toFixed(1)} s (${JSON.stringify(totals)})`);
    expect(totals.personalOps).toBeGreaterThan(0);
    expect(totals.skippedBatches).toBeGreaterThan(0);
    expect(totals.oldWrites).toBeGreaterThan(0);
  });
});
