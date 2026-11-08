import type { Database } from '@sqlite.org/sqlite-wasm';
import {
  hlcReceive, INSERT_FIELDS, mergeOp, parseRemoteOp, tierOf,
  type DeviceId, type FieldValue, type Hlc, type Instant, type OpWire, type RemoteOp, type Table,
} from '@readerlog/core';
import { readMeta, rollbackQuietly, upsertRow, writeMeta } from './apply.ts';

export type SyncProblem = 'offline' | 'relay' | 'spaceGone' | 'unauthorized' | 'newerVersion' | 'corrupt';

export interface SyncStatus {
  lastOkAt: Instant | null;
  problem: SyncProblem | null;
  undecryptable: number;
}

export interface SyncMeta {
  /** The 32-byte sync code, base64url. null means sync is off. */
  key: string | null;
  /** The last applied relay seq. */
  cursor: number;
  pendingBatch: { batchId: string; maxSeq: number } | null;
  status: SyncStatus | null;
  /** The old space's sync code (base64url) while its DELETE after a reset is still owed: deleting needs the old token. */
  oldSpace: string | null;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  parked: number;
}

type Outcome = 'applied' | 'parked';

function canInsert(db: Database, op: RemoteOp): boolean {
  if (!INSERT_FIELDS[op.tbl].every((f) => Object.hasOwn(op.fields, f))) return false;
  // A reading event whose item hasn't arrived yet can't be inserted (foreign key): wait for it.
  // Likewise a highlight whose item hasn't arrived.
  if (op.tbl === 'reading_events' || op.tbl === 'highlights') {
    return db.selectValue('SELECT 1 FROM items WHERE id = ?', [op.fields.item_id]) !== undefined;
  }
  return true;
}

/** Merge one op into the tables. Assumes its op_id is not in change_log yet. */
function applyOne(db: Database, op: RemoteOp, deviceId: DeviceId, wallMs: () => number): Outcome {
  const exists = db.selectValue(`SELECT 1 FROM ${op.tbl} WHERE id = ?`, [op.rowId]) !== undefined;
  if (!exists && !canInsert(db, op)) return 'parked';

  const winning = mergeOp((field) => {
    const c = db.selectValue('SELECT hlc FROM field_clock WHERE tbl = ? AND row_id = ? AND field = ?', [op.tbl, op.rowId, field]);
    return typeof c === 'string' ? (c as Hlc) : null;
  }, op);

  if (winning.length > 0) {
    const fields: Record<string, FieldValue> = {};
    for (const f of winning) fields[f] = op.fields[f]!;
    upsertRow(db, { tbl: op.tbl, rowId: op.rowId, fields });
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
 * Apply ops pulled from the relay, all or nothing (FR-012). Remote ops are the constitution IV
 * exception: they are merged field by field, never re-decided. See contracts/sync-client.md.
 */
export function applyRemoteOps(db: Database, ops: readonly RemoteOp[], deviceId: DeviceId, wallMs: () => number): ApplyResult {
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
      if (applyOne(db, op, deviceId, wallMs) === 'applied') {
        applied++;
      } else {
        db.exec('INSERT INTO sync_inbox (op_id, hlc, device_id, tbl, row_id, fields_json) VALUES (?, ?, ?, ?, ?, ?)', {
          bind: [op.opId, op.hlc, op.deviceId, op.tbl, op.rowId, JSON.stringify(op.fields)],
        });
        parkedIds.add(op.opId);
      }
    }

    // Retry the inbox until a pass applies nothing (research R5).
    for (let progress = true; progress; ) {
      progress = false;
      const rows = db.selectObjects('SELECT op_id, hlc, device_id, tbl, row_id, fields_json FROM sync_inbox ORDER BY hlc, op_id');
      for (const r of rows) {
        const parsed = parseRemoteOp(
          { op: r.op_id as string, hlc: r.hlc as string, tbl: r.tbl as string, row: r.row_id as string, fields: JSON.parse(r.fields_json as string) as OpWire['fields'] },
          r.device_id as string,
        );
        if (!parsed.ok) throw new Error('corrupt sync_inbox row');
        if (!inChangeLog(db, parsed.value.opId) && applyOne(db, parsed.value, deviceId, wallMs) === 'parked') continue;
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
 * Local (not yet pushed) ops in seq order, as they go into an encrypted batch (FR-004). A batch holds one
 * tier only (007 contracts/sync-tiers.md): it ends before the first op whose tier differs from the first op's,
 * so an older version that skips a batch it can't read never skips a base op with it.
 */
/**
 * The next batch to push. A new batch is single-tier: it ends where `tierOf` changes, so a device
 * that doesn't know the `highlights` table skips only highlight batches (007 research R2). A re-send
 * (`upToSeq` given) returns every unpushed op up to that seq, so the retried batch matches the one
 * first sent, and `completePush(maxSeq)` never marks an unsent op as pushed.
 */
export function unpushedOps(db: Database, limit: number, upToSeq?: number): { maxSeq: number; ops: OpWire[] } {
  const rows = db.selectObjects(
    'SELECT seq, op_id, hlc, tbl, row_id, fields_json FROM change_log WHERE pushed = 0 AND seq <= ? ORDER BY seq LIMIT ?',
    [upToSeq ?? Number.MAX_SAFE_INTEGER, limit],
  );
  let maxSeq = 0;
  const ops: OpWire[] = [];
  const fieldsOf = (r: (typeof rows)[number]) => JSON.parse(r.fields_json as string) as OpWire['fields'];
  const tier = rows.length > 0 ? tierOf(rows[0]!.tbl as Table, fieldsOf(rows[0]!)) : null;
  for (const r of rows) {
    if (upToSeq === undefined && tierOf(r.tbl as Table, fieldsOf(r)) !== tier) break;
    maxSeq = Math.max(maxSeq, r.seq as number);
    ops.push({
      op: r.op_id as string,
      hlc: r.hlc as string,
      tbl: r.tbl as Table,
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

/** Apply one pulled page of ops and advance the cursor in the same transaction (research R6). */
export function applyPulledPage(db: Database, ops: readonly RemoteOp[], cursor: number, deviceId: DeviceId, wallMs: () => number): ApplyResult {
  db.exec('SAVEPOINT pulled_page');
  try {
    const result = applyRemoteOps(db, ops, deviceId, wallMs);
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

