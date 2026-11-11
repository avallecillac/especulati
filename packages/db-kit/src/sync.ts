import type { Database } from '@sqlite.org/sqlite-wasm';
import {
  hlcReceive, mergeOp, parseRemoteOpWith,
  type ApplyResult, type DeviceId, type FieldValue, type Hlc, type OpWire, type RemoteOp, type SyncMeta, type SyncSchema,
} from '@especulati/sync-core';
import { readMeta, rollbackQuietly, upsertRow, writeMeta } from './apply.ts';

type Outcome = 'applied' | 'parked';

/**
 * App hook: can this op create its row now? Only called for a row that does not exist yet. Return
 * false to park the op in `sync_inbox` until what it depends on (a parent row) has arrived.
 */
export type CanInsert<T extends string = string> = (db: Database, op: RemoteOp<T>) => boolean;

/** The default hook: the op carries every insert-required field of its table. */
export const defaultCanInsert =
  <T extends string>(schema: SyncSchema<T>): CanInsert<T> =>
  (_db, op) =>
    schema.insertRequired[op.tbl].every((f) => Object.hasOwn(op.fields, f));

/** Merge one op into the tables. Assumes its op_id is not in change_log yet. */
function applyOne<T extends string>(
  db: Database, schema: SyncSchema<T>, canInsert: CanInsert<T>, op: RemoteOp<T>, deviceId: DeviceId, wallMs: () => number,
): Outcome {
  const exists = db.selectValue(`SELECT 1 FROM ${op.tbl} WHERE id = ?`, [op.rowId]) !== undefined;
  if (!exists && !canInsert(db, op)) return 'parked';

  const winning = mergeOp((field) => {
    const c = db.selectValue('SELECT hlc FROM field_clock WHERE tbl = ? AND row_id = ? AND field = ?', [op.tbl, op.rowId, field]);
    return typeof c === 'string' ? (c as Hlc) : null;
  }, op);

  if (winning.length > 0) {
    const fields: Record<string, FieldValue> = {};
    for (const f of winning) fields[f] = op.fields[f]!;
    upsertRow(db, schema, { tbl: op.tbl, rowId: op.rowId, fields });
    for (const f of winning) {
      db.exec(
        `INSERT INTO field_clock (tbl, row_id, field, hlc) VALUES (?, ?, ?, ?)
         ON CONFLICT(tbl, row_id, field) DO UPDATE SET hlc = excluded.hlc`,
        { bind: [op.tbl, op.rowId, f, op.hlc] },
      );
    }
  }
  // Recorded even when every field lost, so the op is never treated as new again. Pushed = 1:
  // it came from the relay and must not go back.
  db.exec(
    'INSERT INTO change_log (op_id, hlc, device_id, tbl, row_id, fields_json, pushed) VALUES (?, ?, ?, ?, ?, ?, 1)',
    { bind: [op.opId, op.hlc, op.deviceId, op.tbl, op.rowId, JSON.stringify(op.fields)] },
  );
  const next = hlcReceive(readMeta(db, 'hlc') as Hlc | null, op.hlc, wallMs(), deviceId);
  writeMeta(db, 'hlc', next);
  return 'applied';
}

const inChangeLog = (db: Database, opId: string): boolean =>
  db.selectValue('SELECT 1 FROM change_log WHERE op_id = ?', [opId]) !== undefined;

/**
 * Apply ops pulled from the relay, all or nothing. Remote ops are the constitution IV
 * exception: they are merged field by field, never re-decided.
 */
export function applyRemoteOps<T extends string>(
  db: Database, schema: SyncSchema<T>, canInsert: CanInsert<T>, ops: readonly RemoteOp<T>[], deviceId: DeviceId, wallMs: () => number,
): ApplyResult {
  const parseOp = parseRemoteOpWith(schema);
  db.exec('SAVEPOINT apply_remote');
  try {
    let applied = 0;
    let skipped = 0;
    const parkedIds = new Set<string>();

    for (const op of ops) {
      if (inChangeLog(db, op.opId) || db.selectValue('SELECT 1 FROM sync_inbox WHERE op_id = ?', [op.opId]) !== undefined) {
        skipped++;
        continue;
      }
      if (applyOne(db, schema, canInsert, op, deviceId, wallMs) === 'applied') {
        applied++;
      } else {
        db.exec('INSERT INTO sync_inbox (op_id, hlc, device_id, tbl, row_id, fields_json) VALUES (?, ?, ?, ?, ?, ?)', {
          bind: [op.opId, op.hlc, op.deviceId, op.tbl, op.rowId, JSON.stringify(op.fields)],
        });
        parkedIds.add(op.opId);
      }
    }

    // Retry the inbox until a pass applies nothing.
    for (let progress = true; progress; ) {
      progress = false;
      const rows = db.selectObjects('SELECT op_id, hlc, device_id, tbl, row_id, fields_json FROM sync_inbox ORDER BY hlc, op_id');
      for (const r of rows) {
        const parsed = parseOp(
          { op: r.op_id as string, hlc: r.hlc as string, tbl: r.tbl as string, row: r.row_id as string, fields: JSON.parse(r.fields_json as string) as OpWire['fields'] },
          r.device_id as string,
        );
        if (!parsed.ok) throw new Error('corrupt sync_inbox row');
        if (!inChangeLog(db, parsed.value.opId) && applyOne(db, schema, canInsert, parsed.value, deviceId, wallMs) === 'parked') continue;
        db.exec('DELETE FROM sync_inbox WHERE op_id = ?', { bind: [parsed.value.opId] });
        parkedIds.delete(parsed.value.opId);
        applied++;
        progress = true;
      }
    }

    db.exec('RELEASE apply_remote');
    return { applied, skipped, parked: parkedIds.size };
  } catch (e) {
    rollbackQuietly(db, 'ROLLBACK TO apply_remote');
    rollbackQuietly(db, 'RELEASE apply_remote');
    throw e;
  }
}

/**
 * The next batch to push. A new batch is single-tier: it ends where `schema.tierOf` changes, so a
 * device that doesn't know a newer table skips only that tier's batches. A re-send (`upToSeq`
 * given) returns every unpushed op up to that seq, so the retried batch matches the one first
 * sent, and `completePush(maxSeq)` never marks an unsent op as pushed.
 */
export function unpushedOps<T extends string>(
  db: Database, schema: SyncSchema<T>, limit: number, upToSeq?: number,
): { maxSeq: number; ops: OpWire[] } {
  const rows = db.selectObjects(
    'SELECT seq, op_id, hlc, tbl, row_id, fields_json FROM change_log WHERE pushed = 0 AND seq <= ? ORDER BY seq LIMIT ?',
    [upToSeq ?? Number.MAX_SAFE_INTEGER, limit],
  );
  let maxSeq = 0;
  const ops: OpWire[] = [];
  const fieldsOf = (r: (typeof rows)[number]) => JSON.parse(r.fields_json as string) as OpWire['fields'];
  const tier = rows.length > 0 ? schema.tierOf(rows[0]!.tbl as T, fieldsOf(rows[0]!)) : null;
  for (const r of rows) {
    if (upToSeq === undefined && schema.tierOf(r.tbl as T, fieldsOf(r)) !== tier) break;
    maxSeq = Math.max(maxSeq, r.seq as number);
    ops.push({
      op: r.op_id as string,
      hlc: r.hlc as string,
      tbl: r.tbl as string,
      row: r.row_id as string,
      fields: fieldsOf(r),
    });
  }
  return { maxSeq, ops };
}

export function markPushed(db: Database, maxSeq: number): void {
  db.exec('UPDATE change_log SET pushed = 1 WHERE pushed = 0 AND seq <= ?', { bind: [maxSeq] });
}

/** A batch was accepted: its rows are pushed and the pending batch is cleared, together. */
export function completePush(db: Database, maxSeq: number): void {
  db.exec('SAVEPOINT complete_push');
  try {
    markPushed(db, maxSeq);
    db.exec("DELETE FROM meta WHERE key = 'pending_batch'");
    db.exec('RELEASE complete_push');
  } catch (e) {
    rollbackQuietly(db, 'ROLLBACK TO complete_push');
    rollbackQuietly(db, 'RELEASE complete_push');
    throw e;
  }
}

/** Apply one pulled page of ops and advance the cursor in the same transaction. */
export function applyPulledPage<T extends string>(
  db: Database, schema: SyncSchema<T>, canInsert: CanInsert<T>, ops: readonly RemoteOp<T>[], cursor: number, deviceId: DeviceId, wallMs: () => number,
): ApplyResult {
  db.exec('SAVEPOINT pulled_page');
  try {
    const result = applyRemoteOps(db, schema, canInsert, ops, deviceId, wallMs);
    writeMeta(db, 'sync_cursor', String(cursor));
    db.exec('RELEASE pulled_page');
    return result;
  } catch (e) {
    rollbackQuietly(db, 'ROLLBACK TO pulled_page');
    rollbackQuietly(db, 'RELEASE pulled_page');
    throw e;
  }
}

/** Local rows waiting to be pushed. */
export function pendingCount(db: Database): number {
  return Number(db.selectValue('SELECT COUNT(*) FROM change_log WHERE pushed = 0'));
}

/** Ops parked in the inbox, waiting for their row to arrive. */
export function inboxOpIds(db: Database): string[] {
  return db.selectValues('SELECT op_id FROM sync_inbox').map(String);
}

/** Joining a different space: everything is pushed again, and the cursor starts over. */
export function resetPushState(db: Database): void {
  db.exec('SAVEPOINT reset_push');
  try {
    db.exec('UPDATE change_log SET pushed = 0 WHERE pushed <> 0');
    writeMeta(db, 'sync_cursor', '0');
    db.exec('RELEASE reset_push');
  } catch (e) {
    rollbackQuietly(db, 'ROLLBACK TO reset_push');
    rollbackQuietly(db, 'RELEASE reset_push');
    throw e;
  }
}

const parseJson = <T>(s: string | null): T | null => {
  if (s === null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

export function syncMeta(db: Database): SyncMeta {
  const cursor = Number(readMeta(db, 'sync_cursor') ?? 0);
  return {
    key: readMeta(db, 'sync_key'),
    cursor: Number.isFinite(cursor) ? cursor : 0,
    pendingBatch: parseJson(readMeta(db, 'pending_batch')),
    status: parseJson(readMeta(db, 'sync_status')),
    oldSpace: readMeta(db, 'sync_old_space'),
  };
}

/** `undefined` leaves a key alone; `null` removes it. */
export function setSyncMeta(db: Database, patch: Partial<Omit<SyncMeta, 'cursor'>> & { cursor?: number | null }): void {
  const put = (key: string, value: string | null | undefined): void => {
    if (value === undefined) return;
    if (value === null) db.exec('DELETE FROM meta WHERE key = ?', { bind: [key] });
    else writeMeta(db, key, value);
  };
  const json = (v: unknown): string | null | undefined => (v === undefined ? undefined : v === null ? null : JSON.stringify(v));
  db.exec('SAVEPOINT set_sync_meta');
  try {
    put('sync_key', patch.key);
    put('sync_cursor', patch.cursor === undefined || patch.cursor === null ? patch.cursor : String(patch.cursor));
    put('pending_batch', json(patch.pendingBatch));
    put('sync_status', json(patch.status));
    put('sync_old_space', patch.oldSpace);
    db.exec('RELEASE set_sync_meta');
  } catch (e) {
    rollbackQuietly(db, 'ROLLBACK TO set_sync_meta');
    rollbackQuietly(db, 'RELEASE set_sync_meta');
    throw e;
  }
}
