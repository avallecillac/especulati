import type { Database } from '@sqlite.org/sqlite-wasm';
import {
  cinefiloSchema, decide, entryLabel, err, ok, parseTitlesFile,
  type Change, type Command, type Instant, type ParseError, type Result, type TitleEntry,
} from '@especulati/cinefilo-core';
import { applyChanges, rollbackQuietly } from '@especulati/db-kit';
import type { DeviceId } from '@especulati/sync-core';
import { findByTmdb } from './queries.ts';
import { loadSnapshot, maxWatchOrder, titleRow } from './snapshot.ts';
import type { DispatchEnv } from './types.ts';

/** SHA-256 → uuid of a label (the shell's `uuidFromHash`); async, so it runs before the transaction opens. */
export type ImportEnv = Pick<DispatchEnv, 'now' | 'wallMs' | 'newOpId'> & { hash: (label: string) => Promise<string> };

export interface ImportTitlesResult {
  /** Entries that would be (or were) added. */
  readonly new: number;
  /** Entries already in the list (same derived id, or the same TMDB id and kind): left as they are. */
  readonly existing: number;
  /** Existing watched titles with no watch order that the file numbers (D4); new titles carrying one are not counted here. */
  readonly ordersToSet: number;
  /** Entries `decide()` refused. */
  readonly invalid: number;
  readonly reasons: readonly { readonly index: number; readonly title: string; readonly reason: string }[];
  /** True when the changes were written (false for a dry run). */
  readonly applied: boolean;
}

/** The i-th entry is stamped i ms earlier, so the file's first entry is the newest and lists keep the file's order. */
const stamp = (now: Instant, i: number): Instant => new Date(Date.parse(now) - i).toISOString() as Instant;

/**
 * D3: one `AddTitle` through `decide()` per entry, all applied in ONE transaction (or none). A dry run does the same
 * pass without writing. Ids are the shell's derived ids, so a TMDB entry equals a TMDB search add. Idempotent.
 */
export async function importTitles(
  db: Database, text: string, deviceId: DeviceId, memberId: string | null, env: ImportEnv, opts: { dryRun?: boolean } = {},
): Promise<Result<ImportTitlesResult, ParseError>> {
  const parsed = parseTitlesFile(text);
  if (!parsed.ok) return err(parsed.error);
  if (memberId === null) return err({ field: 'member', reason: 'this device has no member yet' });
  const entries: readonly TitleEntry[] = parsed.value.titles;
  const ids = await Promise.all(entries.map((e) => env.hash(entryLabel(e))));

  const changes: Change[] = [];
  const reasons: { index: number; title: string; reason: string }[] = [];
  let existing = 0;
  let added = 0;
  let ordersToSet = 0;
  // New watched entries without an order are numbered after every order in the file and in the list.
  let runningMax = entries.reduce<number | null>((m, e) => (e.watchOrder !== null && (m === null || e.watchOrder > m) ? e.watchOrder : m), maxWatchOrder(db));
  /** D4: an existing live Together title keeps its order; one without gets the file's (watched titles only). Never overwritten. */
  const settle = (e: TitleEntry, id: string): boolean => {
    const row = titleRow(db, id);
    if (!row || row.deletedAt !== null || row.mergedInto !== null || row.status === null) return false;
    existing++;
    if (e.watchOrder !== null && row.watchOrder === null && row.status === 'watched') {
      ordersToSet++;
      changes.push({ tbl: 'titles', rowId: row.id, fields: { watch_order: e.watchOrder } });
    }
    return true;
  };
  entries.forEach((e, i) => {
    const tmdbMatch = e.tmdbId !== null ? findByTmdb(db, e.tmdbId, e.kind) : null;
    if (tmdbMatch !== null && settle(e, tmdbMatch)) return;
    if (settle(e, ids[i]!)) return;
    const cmd: Command = {
      kind: 'AddTitle', titleId: ids[i]!, mediaKind: e.kind, title: e.title, status: e.status, addedBy: memberId,
      ...(e.year !== null ? { year: e.year } : {}), ...(e.tmdbId !== null ? { tmdbId: e.tmdbId } : {}),
    };
    const snap = { ...loadSnapshot(db, cmd, memberId), maxWatchOrder: runningMax };
    const d = decide(snap, cmd, stamp(env.now, i));
    if (d.ok) {
      added++;
      const wantsOrder = e.watchOrder !== null && (snap.title?.watchOrder ?? null) === null;
      for (const c of d.value.changes) {
        const f = wantsOrder && c.tbl === 'titles' ? { ...c, fields: { ...c.fields, watch_order: e.watchOrder } } : c;
        const given = f.tbl === 'titles' ? f.fields['watch_order'] : undefined;
        if (typeof given === 'number' && (runningMax === null || given > runningMax)) runningMax = given;
        changes.push(f);
      }
      return;
    }
    if (d.error.kind === 'AlreadyExists') { existing++; return; }
    reasons.push({ index: i, title: e.title, reason: d.error.kind === 'InvalidInput' ? `${d.error.field}: ${d.error.reason}` : d.error.kind });
  });

  const applied = opts.dryRun !== true && reasons.length === 0;
  if (applied && changes.length > 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      applyChanges(db, cinefiloSchema, changes, deviceId, env.wallMs, env.newOpId);
      db.exec('COMMIT');
    } catch (e) {
      rollbackQuietly(db, 'ROLLBACK');
      throw e;
    }
  }
  return ok({ new: added, existing, ordersToSet, invalid: reasons.length, reasons, applied });
}
