// Design D4 at the DB level: find titles that share (tmdb_id, kind) and dispatch the pure ReconcileTitles
// for each pair. Runs after every sync and after a local AddTitle / LinkToTmdb, on every device. All ids are
// derived (the shell's SHA-256 `hash`), and decide() uses no clock, so devices reconciling the same state
// write the same values. Runs in the DB worker (or a test); the UI never calls it.

import {
  memberStatusLabel, ratingLabel, recommendationLabel, tmdbTitleLabel,
  type Kind,
} from '@especulati/cinefilo-core';
import type { Database } from '@sqlite.org/sqlite-wasm';
import type { Command, Rejection, Result } from '@especulati/cinefilo-core';
import type { DispatchEnv, DispatchOutcome } from './types.ts';
import { intOrNull, text, textOrNull } from './snapshot.ts';

/** SHA-256 → uuid of a label: the shell's `uuidFromHash`. */
export type Hash = (label: string) => Promise<string>;

/** The part of CinefiloDb reconcile needs (kept structural: no import cycle with index.ts). */
export interface ReconcileTarget {
  readonly raw: Database;
  dispatch(cmd: Command, env: DispatchEnv): Result<DispatchOutcome, Rejection>;
}

interface Group {
  readonly kind: Kind;
  readonly tmdbId: number;
  readonly rows: readonly { id: string; mergedInto: string | null }[];
}

function groups(db: ReconcileTarget): Group[] {
  const out: Group[] = [];
  const rows = db.raw.selectObjects('SELECT id, kind, tmdb_id, merged_into FROM titles WHERE tmdb_id IS NOT NULL ORDER BY kind, tmdb_id, id');
  for (const r of rows) {
    const kind = text(r['kind'], 'kind') as Kind;
    const tmdbId = intOrNull(r['tmdb_id'], 'tmdb_id')!;
    const last = out[out.length - 1];
    const row = { id: text(r['id'], 'id'), mergedInto: textOrNull(r['merged_into'], 'merged_into') };
    if (last && last.kind === kind && last.tmdbId === tmdbId) (last.rows as (typeof row)[]).push(row);
    else out.push({ kind, tmdbId, rows: [row] });
  }
  return out.filter((g) => g.rows.length > 1);
}

/** One pass over every group. Returns how many pairs produced changes. */
async function pass(db: ReconcileTarget, env: () => DispatchEnv, hash: Hash): Promise<number> {
  let changed = 0;
  for (const g of groups(db)) {
    const tmdbTitleId = await hash(tmdbTitleLabel(g.kind, g.tmdbId));
    // Same survivor rule as core: the TMDB-derived id when present, else the smallest id.
    const survivor = g.rows.find((r) => r.id === tmdbTitleId) ?? g.rows[0]!;
    if (survivor.mergedInto !== null) continue;
    for (const loser of g.rows) {
      if (loser.id === survivor.id) continue;
      if (loser.mergedInto !== null && loser.mergedInto !== survivor.id) continue; // core refuses a loser merged elsewhere
      const members = db.raw
        .selectValues('SELECT DISTINCT member_id FROM ratings WHERE title_id = ? ORDER BY member_id', [loser.id])
        .map(String);
      const ratingIds = await Promise.all(
        members.map(async (memberId) => ({ titleId: survivor.id, memberId, ratingId: await hash(ratingLabel(survivor.id, memberId)) })),
      );
      const memberStatusIds = await Promise.all(
        db.raw
          .selectValues('SELECT DISTINCT member_id FROM member_status WHERE title_id = ? ORDER BY member_id', [loser.id])
          .map(String)
          .map(async (memberId) => ({ titleId: survivor.id, memberId, id: await hash(memberStatusLabel(survivor.id, memberId)) })),
      );
      const recommendationIds = await Promise.all(
        db.raw
          .selectObjects('SELECT DISTINCT from_member, to_member FROM recommendations WHERE title_id = ? ORDER BY from_member, to_member', [loser.id])
          .map(async (r) => {
            const [fromMember, toMember] = [text(r['from_member'], 'from_member'), text(r['to_member'], 'to_member')];
            return { titleId: survivor.id, fromMember, toMember, id: await hash(recommendationLabel(survivor.id, fromMember, toMember)) };
          }),
      );
      const r = db.dispatch(
        { kind: 'ReconcileTitles', titleA: survivor.id, titleB: loser.id, tmdbTitleId, ratingIds, memberStatusIds, recommendationIds },
        env(),
      );
      if (r.ok && r.value.changes > 0) changed++;
    }
  }
  return changed;
}

/**
 * Reconcile until nothing changes (bounded). Idempotent: the loser is marked, and a later pass writes only
 * what a late edit to the loser made newer. Returns the number of pairs that changed anything.
 */
export async function reconcileAll(db: ReconcileTarget, env: () => DispatchEnv, hash: Hash): Promise<number> {
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const n = await pass(db, env, hash);
    if (n === 0) break;
    total += n;
  }
  return total;
}
